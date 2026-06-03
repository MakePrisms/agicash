/**
 * Account domain types — §2 of the contract.
 *
 * Lifted verbatim from `app/features/accounts/account.ts` (hand-written TS:
 * `type = base ∧ cashu|spark union`; discriminant `type`, NOT `kind`) and
 * `app/features/accounts/cashu-account.ts` (`CashuProof` = `z.infer` of a
 * zod/mini schema). The SDK OWNS these types; the wallet imports them (decision 7).
 *
 * `wallet` is a LIVE handle (`ExtendedCashuWallet` / `BreezSdk`) kept verbatim —
 * no `AccountData` split (decision 7-i). Here those handles are placeholder types
 * (see ./dependencies); they become real in later slices.
 */
import type {
  BreezSdk,
  DistributedOmit,
  ExtendedCashuWallet,
  ProofDleq,
  ProofWitness,
  SparkNetwork,
} from './dependencies';
import type { Currency, Money } from './money';

/** Protocol backing an account: cashu ecash or a Spark (Breez) wallet. */
export type AccountType = 'cashu' | 'spark';

/** Whether the account is usable (`active`) or has expired (e.g. an expired offer keyset). */
export type AccountState = 'active' | 'expired';

/**
 * What the account exists for. Only `transactional` accounts can send/receive
 * over Lightning; `gift-card`/`offer` accounts are UI-only in v1 but the field
 * is carried because `canSendToLightning`/`canReceiveFromLightning` gate on it.
 */
export type AccountPurpose = 'transactional' | 'gift-card' | 'offer';

/**
 * A single cashu proof (a unit of ecash) held by a cashu `Account`.
 *
 * Lifted from `app/features/accounts/cashu-account.ts` (a `zod/mini` schema,
 * here as its `z.infer` shape). The `state` tracks the proof through the
 * stale-proof reservation lifecycle (`UNSPENT` → `RESERVED` during an in-flight
 * send → `SPENT`); `version` supports optimistic locking on the row.
 */
export type CashuProof = {
  /** UUID of the proof row. */
  id: string;
  /** UUID of the cashu account the proof belongs to. */
  accountId: string;
  /** UUID of the owning user. */
  userId: string;
  /** ID of the mint keyset this proof was issued under. */
  keysetId: string;
  /** Denomination of the proof, in the mint's cashu unit (e.g. sats / cents). */
  amount: number;
  /** The proof's blinded secret. */
  secret: string;
  /** The mint's unblinded signature (cashu-ts `Proof.C`). */
  unblindedSignature: string;
  /** The proof's public key Y value (used for proof-state lookups). */
  publicKeyY: string;
  /** `Proof['dleq']` from @cashu/cashu-ts (placeholder in PR1, see ./dependencies). */
  dleq: ProofDleq;
  /** `Proof['witness']` from @cashu/cashu-ts (placeholder in PR1, see ./dependencies). */
  witness: ProofWitness;
  /** Reservation state: `RESERVED` while an in-flight send holds it; otherwise `UNSPENT`/`SPENT`. */
  state: 'UNSPENT' | 'RESERVED' | 'SPENT';
  /** Row version; used for optimistic locking. */
  version: number;
  /** Creation time, as an ISO 8601 timestamp. */
  createdAt: string;
  /** When the proof was reserved by an in-flight send (null/absent otherwise). */
  reservedAt?: string | null;
  /** When the proof was spent (null/absent otherwise). */
  spentAt?: string | null;
};

/**
 * A wallet account — a per-currency balance backed by either a cashu mint or a
 * Spark (Breez) wallet. The SDK OWNS this domain type and the web/MCP consumers
 * import it (decision 7); it is lifted verbatim from
 * `app/features/accounts/account.ts`.
 *
 * Shape = a common base intersected with a `type`-discriminated union (`type` is
 * the discriminant, NOT `kind`). Methods take the NARROW variant (`CashuAccount`
 * / `SparkAccount`) so TS rejects e.g. passing a cashu account to a spark op. The
 * `wallet` field on each variant is a LIVE protocol handle — not serializable and
 * never a DB read.
 */
export type Account = {
  id: string;
  name: string;
  type: AccountType;
  purpose: AccountPurpose;
  state: AccountState;
  /** gates canSendToLightning / canReceiveFromLightning */
  isOnline: boolean;
  currency: Currency;
  /** ISO 8601 */
  createdAt: string;
  /** Row version; used for optimistic locking. */
  version: number;
  /**
   * The account expiry time, as an ISO 8601 timestamp.
   * For offer accounts, this is when the ecash expires (derived from keyset expiry).
   * Null for accounts that don't expire.
   */
  expiresAt: string | null;
} & (
  | {
      type: 'cashu';
      mintUrl: string;
      isTestMint: boolean;
      /**
       * Holds counter value for each mint keyset. Key is the keyset id, value is counter value.
       */
      keysetCounters: Record<string, number>;
      /**
       * Holds all cashu proofs for the account.
       * Amounts are denominated in the cashu units (e.g. sats for BTC accounts, cents for USD accounts).
       */
      proofs: CashuProof[];
      /** LIVE handle — mint info/keysets/keys/seed (protocol-metadata memo). Not serializable. */
      wallet: ExtendedCashuWallet;
    }
  | {
      type: 'spark';
      balance: Money | null;
      network: SparkNetwork;
      /**
       * The Spark wallet instance for the account.
       * If the wallet is not online, this will be a stub that throws on any method call.
       */
      wallet: BreezSdk;
    }
);

// derivations (master, verbatim):

/** An `Account` of a given `type` augmented with whether it is the default for its currency. */
export type ExtendedAccount<T extends AccountType = AccountType> = Extract<
  Account,
  { type: T }
> & { isDefault: boolean };

/** The cashu-only narrowing of `Account`. */
export type CashuAccount = Extract<Account, { type: 'cashu' }>;
/** The spark-only narrowing of `Account`. */
export type SparkAccount = Extract<Account, { type: 'spark' }>;
/** Cashu `ExtendedAccount` (carries `isDefault`). */
export type ExtendedCashuAccount = ExtendedAccount<'cashu'>;
/** Spark `ExtendedAccount` (carries `isDefault`). */
export type ExtendedSparkAccount = ExtendedAccount<'spark'>;

/**
 * Account type without sensitive data (e.g. proofs for cashu accounts).
 * Useful for cases where you need to use non sensitive account data in contexts
 * where sensitive data cannot be decrypted (on server).
 *
 * (`DistributedOmit` is a PR1 placeholder — see ./dependencies.)
 */
export type RedactedAccount = DistributedOmit<Account, 'proofs'>;
/** The cashu-only narrowing of `RedactedAccount`. */
export type RedactedCashuAccount = Extract<RedactedAccount, { type: 'cashu' }>;
