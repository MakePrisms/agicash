/**
 * Account live-handle resolver — the Slice-2 / Slice-3 seam.
 *
 * An `Account`'s `wallet` field is a LIVE protocol handle (a cashu `ExtendedCashuWallet`
 * or a `BreezSdk` instance), and a cashu account's `proofs` are DECRYPTED from the DB rows.
 * Master builds BOTH in one place — `account-repository.toAccount` — by calling
 * `getInitializedCashuWallet` / `getInitializedSparkWallet` (a heavy, networked mint/Breez
 * init that fetches keysets/keys with a 10s timeout) and `Encryption.decryptBatch` (the
 * OpenSecret-derived encryption key + ECIES).
 *
 * **Per the build plan, that heavy construction is Slice 3, not Slice 2.** The plan puts
 * the per-mint protocol-metadata memo (`ExtendedCashuWallet`), the mint-WS managers, the
 * `lib/cashu/**` absorption, and `@agicash/breez-sdk-spark` all in Slice 3 ("THE HEAVY
 * one"); Slice 2 owns the account DB read/write + scan + `suggestFor`. Proof DECRYPTION is
 * equally entangled (same `toAccount` call, same `shared/encryption` subsystem) and rides
 * with it.
 *
 * This module is the explicit injection seam between the two slices:
 *  - `AccountHandleResolver` is the interface the account repository depends on to fill in
 *    the deferred `wallet` (+ a cashu account's `isOnline` and decrypted `proofs`).
 *  - {@link DeferredAccountHandleResolver} is the Slice-2 stub: it constructs accounts from
 *    the DB fields Slice 2 owns and leaves the live handle deferred — any *use* of `wallet`
 *    (or decrypted `proofs`) throws {@link NotImplementedError} via a lazy stub. (Still used
 *    by the repository's DB-mapping unit tests, which exercise row→domain in isolation.)
 *  - {@link LiveAccountHandleResolver} is the REAL Slice-3 implementation (this PR): it
 *    initialises the cashu mint wallet ({@link getInitializedCashuWallet}) + decrypts the
 *    proofs (OpenSecret-derived key + ECIES) and connects the spark Breez wallet
 *    ({@link getInitializedSparkWallet}). `Sdk.create` wires THIS resolver into the
 *    repository — no change to the repository itself (the whole point of the seam).
 *
 * @module
 */
import {
  type MintMetadataCache,
  getInitializedCashuWallet,
} from './cashu-wallet';
import type { Encryption } from './encryption';
import { ProofSchema } from './lib-cashu-wallet';
import {
  type BreezRuntime,
  type SparkWalletCache,
  getInitializedSparkWallet,
} from './spark-wallet';
import { NotImplementedError } from '../errors';
import type {
  BreezSdk,
  CashuProof,
  ExtendedCashuWallet,
  SparkNetwork,
} from '../types/account';
import { z } from 'zod/mini';
import type { Currency } from '../types/money';

/** Inputs needed to (eventually) initialise a cashu account's live wallet + proofs. */
export type CashuHandleRequest = {
  mintUrl: string;
  currency: Currency;
  /** Encrypted `(amount, secret)` proof rows from the DB, awaiting decryption (Slice 3). */
  encryptedProofs: EncryptedCashuProofRow[];
};

/** The encrypted-on-the-row fields of a cashu proof the resolver decrypts in Slice 3. */
export type EncryptedCashuProofRow = {
  id: string;
  accountId: string;
  userId: string;
  keysetId: string;
  /** Encrypted ciphertext (decrypted to a `number` in Slice 3). */
  amount: string;
  /** Encrypted ciphertext (decrypted to a `string` in Slice 3). */
  secret: string;
  unblindedSignature: string;
  publicKeyY: string;
  dleq: CashuProof['dleq'];
  witness: CashuProof['witness'];
  state: CashuProof['state'];
  version: number;
  createdAt: string;
  reservedAt?: string | null;
  spentAt?: string | null;
};

/** What the resolver returns for a cashu account: the live wallet, online flag, + proofs. */
export type ResolvedCashuHandle = {
  wallet: ExtendedCashuWallet;
  isOnline: boolean;
  proofs: CashuProof[];
};

/** What the resolver returns for a spark account: the live wallet, online flag, + balance. */
export type ResolvedSparkHandle = {
  wallet: BreezSdk;
  isOnline: boolean;
  balance: ResolvedSparkBalance;
};

/** Spark balance the resolver derives from the live wallet (Slice 3); deferred to `null` here. */
export type ResolvedSparkBalance = import('../types/money').Money | null;

/**
 * Fills in an account's deferred, connection-bound fields (the live `wallet` handle, online
 * status, decrypted cashu proofs / spark balance). Slice 2 supplies a deferral stub; Slice 3
 * supplies the real mint/Breez init + proof decryption.
 */
export interface AccountHandleResolver {
  /** Resolve a cashu account's live wallet, online flag, and decrypted proofs. */
  resolveCashu(request: CashuHandleRequest): Promise<ResolvedCashuHandle>;
  /** Resolve a spark account's live wallet, online flag, and balance. */
  resolveSpark(request: {
    network: SparkNetwork;
  }): Promise<ResolvedSparkHandle>;
}

/**
 * Build a lazy stub that stands in for a not-yet-constructed live wallet handle. Reading
 * any property (e.g. calling `wallet.getMintInfo()`) throws {@link NotImplementedError}
 * naming the slice that fills it in, so a deferred handle fails loudly + identifiably
 * rather than surfacing as `undefined`. The account's plain DB fields remain fully usable.
 *
 * @param label - identifies the handle in the thrown message (e.g. `'ExtendedCashuWallet'`).
 * @returns a `Proxy` typed as `T` whose every access throws.
 */
function deferredHandle<T>(label: string): T {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        // Let well-known introspection symbols resolve to undefined so the stub can be
        // safely held / logged / spread without tripping the throw (only real *use* throws).
        if (typeof prop === 'symbol') {
          return undefined;
        }
        throw new NotImplementedError(
          `${label}.${String(prop)} (live wallet handle is constructed in @agicash/wallet-sdk Slice 3)`,
        );
      },
    },
  ) as T;
}

/**
 * Slice-2 {@link AccountHandleResolver}: constructs accounts from the DB fields this slice
 * owns and DEFERS the live wallet handle + proof decryption to Slice 3.
 *
 * - cashu: `wallet` is a deferred {@link deferredHandle} stub, `isOnline` is reported
 *   `false` (no mint was contacted), and `proofs` is `[]` (decryption is Slice 3 — the
 *   encrypted ciphertext is intentionally NOT surfaced as a proof). Consumers that only
 *   read DB fields (`mintUrl`, `keysetCounters`, `currency`, defaults, `suggestFor` online-
 *   filtering) work; anything that needs the live mint or real proofs gets a labelled throw.
 * - spark: `wallet` is a deferred stub, `isOnline` is `false`, `balance` is `null`.
 */
export class DeferredAccountHandleResolver implements AccountHandleResolver {
  /** Deferred cashu handle: stub wallet, offline, no decrypted proofs (Slice 3 fills these). */
  async resolveCashu(
    _request: CashuHandleRequest,
  ): Promise<ResolvedCashuHandle> {
    return {
      wallet: deferredHandle<ExtendedCashuWallet>('ExtendedCashuWallet'),
      isOnline: false,
      proofs: [],
    };
  }

  /** Deferred spark handle: stub wallet, offline, null balance (Slice 3 fills these). */
  async resolveSpark(_request: {
    network: SparkNetwork;
  }): Promise<ResolvedSparkHandle> {
    return {
      wallet: deferredHandle<BreezSdk>('BreezSdk'),
      isOnline: false,
      balance: null,
    };
  }
}

/** Dependencies the live resolver needs (the per-user secrets + memos + Breez config). */
export type LiveAccountHandleResolverDeps = {
  /** Decrypts the encrypted `(amount, secret)` proof ciphertext (OpenSecret-derived key). */
  encryption: Encryption;
  /** The user's BIP39 cashu wallet seed (master `getCashuWalletSeed`), or undefined. */
  getCashuWalletSeed: () => Promise<Uint8Array | undefined>;
  /** Per-mint protocol-metadata memo (1 h staleTime), shared across resolves. */
  mintCache: MintMetadataCache;
  /** The user's spark wallet seed mnemonic (master `getSparkWalletMnemonic`). */
  getSparkWalletMnemonic: () => Promise<string>;
  /** Per-(mnemonic,network) connected-spark-wallet memo, shared across resolves. */
  sparkCache: SparkWalletCache;
  /** The Breez API key (`SdkConfig.breezApiKey`); spark resolves to a stub when absent. */
  breezApiKey?: string;
  /** Breez storage directory (master `'./.spark-data'`). */
  sparkStorageDir: string;
  /** Optional Breez-runtime injection (tests pass a mock; default = the native module). */
  breezRuntime?: BreezRuntime;
};

/**
 * The REAL {@link AccountHandleResolver} (Slice 3): builds each account's LIVE wallet handle
 * and fills in the connection-bound fields the Slice-2 stub deferred — a cashu account's
 * decrypted `proofs` + live mint wallet, a spark account's live Breez wallet + balance.
 *
 * Mirrors master `account-repository.toAccount`'s per-type construction, re-housed
 * framework-free:
 *  - cashu: in parallel, initialise the mint wallet ({@link getInitializedCashuWallet}, the
 *    1 h-memo'd networked keyset/keys fetch with master's 10 s timeout) and DECRYPT the
 *    proofs (master `decryptCashuProofs`: `encryption.decryptBatch` of the interleaved
 *    `amount`/`secret` ciphertext, then re-parse `dleq`/`witness` via cashu-ts `ProofSchema`).
 *  - spark: connect the Breez wallet ({@link getInitializedSparkWallet}) and read its balance.
 *    When no `breezApiKey` is configured, spark stays a labelled stub + offline (the SDK can
 *    run cashu-only without Breez).
 *
 * The mint/spark memos are constructor-injected so they live as long as the resolver (one
 * per `Sdk` instance) and are dropped on `Sdk.destroy()`.
 */
export class LiveAccountHandleResolver implements AccountHandleResolver {
  constructor(private readonly deps: LiveAccountHandleResolverDeps) {}

  /**
   * Resolve a cashu account's live wallet, online flag, and decrypted proofs.
   *
   * @param request - the mint URL, currency, and encrypted proof rows.
   * @returns the live cashu handle.
   */
  async resolveCashu(
    request: CashuHandleRequest,
  ): Promise<ResolvedCashuHandle> {
    const seed = await this.deps.getCashuWalletSeed();
    const [{ wallet, isOnline }, proofs] = await Promise.all([
      getInitializedCashuWallet({
        cache: this.deps.mintCache,
        mintUrl: request.mintUrl,
        currency: request.currency,
        bip39seed: seed,
      }),
      this.decryptProofs(request.encryptedProofs),
    ]);
    return { wallet, isOnline, proofs };
  }

  /**
   * Resolve a spark account's live wallet, online flag, and balance. When no Breez API key
   * is configured the wallet is a labelled stub and the account is reported offline.
   *
   * @param request.network - the spark network.
   * @returns the live spark handle.
   */
  async resolveSpark(request: {
    network: SparkNetwork;
  }): Promise<ResolvedSparkHandle> {
    if (!this.deps.breezApiKey) {
      return {
        wallet: deferredHandle<BreezSdk>(
          'BreezSdk (no breezApiKey configured)',
        ),
        isOnline: false,
        balance: null,
      };
    }
    const mnemonic = await this.deps.getSparkWalletMnemonic();
    const { wallet, balance, isOnline } = await getInitializedSparkWallet({
      cache: this.deps.sparkCache,
      mnemonic,
      network: request.network,
      storageDir: this.deps.sparkStorageDir,
      apiKey: this.deps.breezApiKey,
      runtime: this.deps.breezRuntime,
    });
    return { wallet, isOnline, balance };
  }

  /**
   * Decrypt the encrypted proof rows to domain {@link CashuProof}s. Ported from master
   * `account-repository.decryptCashuProofs`: the `amount` + `secret` ciphertext is batch-
   * decrypted in one ECIES call (interleaved, order-preserving), the `amount` re-parsed as a
   * `number` and `secret` as a `string`, and `dleq`/`witness` re-validated via cashu-ts
   * `ProofSchema`. The remaining fields are copied straight off the row.
   */
  private async decryptProofs(
    rows: CashuHandleRequest['encryptedProofs'],
  ): Promise<CashuProof[]> {
    if (rows.length === 0) {
      return [];
    }
    const encryptedData = rows.flatMap((p) => [p.amount, p.secret]);
    const decryptedData =
      await this.deps.encryption.decryptBatch(encryptedData);

    return rows.map((row, index) => {
      const i = index * 2;
      const amount = z.number().parse(decryptedData[i]);
      const secret = z.string().parse(decryptedData[i + 1]);
      return {
        id: row.id,
        accountId: row.accountId,
        userId: row.userId,
        keysetId: row.keysetId,
        amount,
        secret,
        unblindedSignature: row.unblindedSignature,
        publicKeyY: row.publicKeyY,
        dleq: ProofSchema.shape.dleq.parse(row.dleq),
        witness: ProofSchema.shape.witness.parse(row.witness),
        state: row.state,
        version: row.version,
        createdAt: row.createdAt,
        reservedAt: row.reservedAt,
        spentAt: row.spentAt,
      };
    });
  }
}
