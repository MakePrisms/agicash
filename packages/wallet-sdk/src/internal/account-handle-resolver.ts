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
 *  - {@link DeferredAccountHandleResolver} is the Slice-2 implementation: it constructs
 *    accounts from the DB fields Slice 2 owns and leaves the live handle deferred — any
 *    *use* of `wallet` (or decrypted `proofs`) throws {@link NotImplementedError} via a
 *    lazy stub. Slice 3 swaps in the real resolver (mint/Breez init + proof decryption)
 *    with no change to the repository.
 *
 * This keeps PR4 small (no mint/Breez/encryption wiring) while making the account read/
 * write surface — `list` / `get` / `getDefault` / `add` / `setDefault` / `getBalance`
 * (spark, and cashu once Slice 3 decrypts proofs) / `suggestFor` — real and reviewable.
 *
 * @module
 */
import { NotImplementedError } from '../errors';
import type {
  BreezSdk,
  CashuProof,
  ExtendedCashuWallet,
  SparkNetwork,
} from '../types/account';
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
