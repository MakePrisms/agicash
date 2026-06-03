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

export type AccountType = 'cashu' | 'spark';

export type AccountState = 'active' | 'expired';

export type AccountPurpose = 'transactional' | 'gift-card' | 'offer';

/**
 * `CashuProof` — `app/features/accounts/cashu-account.ts` (`z.infer<CashuProofSchema>`).
 */
export type CashuProof = {
  id: string;
  accountId: string;
  userId: string;
  keysetId: string;
  amount: number;
  secret: string;
  unblindedSignature: string;
  publicKeyY: string;
  /** `Proof['dleq']` from @cashu/cashu-ts (placeholder in PR1, see ./dependencies). */
  dleq: ProofDleq;
  /** `Proof['witness']` from @cashu/cashu-ts (placeholder in PR1, see ./dependencies). */
  witness: ProofWitness;
  state: 'UNSPENT' | 'RESERVED' | 'SPENT';
  version: number;
  createdAt: string;
  reservedAt?: string | null;
  spentAt?: string | null;
};

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
      /** Counter value per mint keyset (keysetId -> counter). NUT-13. */
      keysetCounters: Record<string, number>;
      /** All cashu proofs for the account (denominated in cashu units). */
      proofs: CashuProof[];
      /** LIVE handle — mint info/keysets/keys/seed (protocol-metadata memo). Not serializable. */
      wallet: ExtendedCashuWallet;
    }
  | {
      type: 'spark';
      balance: Money | null;
      network: SparkNetwork;
      /** LIVE Breez SDK instance (a connection, NOT DB data); stub-that-throws when offline. */
      wallet: BreezSdk;
    }
);

// derivations (master, verbatim):
export type ExtendedAccount<T extends AccountType = AccountType> = Extract<
  Account,
  { type: T }
> & { isDefault: boolean };

export type CashuAccount = Extract<Account, { type: 'cashu' }>;
export type SparkAccount = Extract<Account, { type: 'spark' }>;
export type ExtendedCashuAccount = ExtendedAccount<'cashu'>;
export type ExtendedSparkAccount = ExtendedAccount<'spark'>;

/**
 * Account type without sensitive data (proofs). Server-safe.
 * (`DistributedOmit` is a PR1 placeholder — see ./dependencies.)
 */
export type RedactedAccount = DistributedOmit<Account, 'proofs'>;
export type RedactedCashuAccount = Extract<RedactedAccount, { type: 'cashu' }>;
