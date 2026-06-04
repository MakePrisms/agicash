// Account domain types — master verbatim (app/features/accounts/account.ts)
// Note: `wallet` fields hold LIVE handles (not serializable).

import type { Currency, Money } from './money';

export type AccountType = 'cashu' | 'spark';
export type AccountState = 'active' | 'expired';
export type AccountPurpose = 'transactional' | 'gift-card' | 'offer';
export type SparkNetwork = 'MAINNET' | 'REGTEST';

// ---- Cashu proof (app/features/accounts/cashu-account.ts, zod/mini z.infer) ----

// Minimal re-export of the DLEQ proof fields from @cashu/cashu-ts
export type ProofDleq = {
  e: string;
  s: string;
  r?: string;
};

export type ProofWitness = {
  signatures?: string[];
};

export type CashuProof = {
  id: string;
  accountId: string;
  userId: string;
  keysetId: string;
  amount: number;
  secret: string;
  unblindedSignature: string;
  publicKeyY: string;
  dleq: ProofDleq | undefined;
  witness: ProofWitness | undefined;
  state: 'UNSPENT' | 'RESERVED' | 'SPENT';
  version: number;
  createdAt: string;
  reservedAt?: string | null;
  spentAt?: string | null;
};

// ---- Live wallet handles (opaque — implementation in deps not imported here) ----

/** Mint info/keysets/keys/seed (protocol-metadata memo). LIVE handle, not serializable. */
export declare abstract class ExtendedCashuWallet {}

/** Live Breez SDK instance (a connection). NOT DB data. Stub-that-throws when offline. */
export declare abstract class BreezSdk {}

// ---- Account union ----

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  purpose: AccountPurpose;
  state: AccountState;
  /** Gates canSendToLightning / canReceiveFromLightning */
  isOnline: boolean;
  currency: Currency;
  createdAt: string; // ISO 8601
  version: number;
  expiresAt: string | null; // ISO 8601; null for non-expiring accounts
} & (
  | {
      type: 'cashu';
      mintUrl: string;
      isTestMint: boolean;
      /** NUT-13 deterministic-secret counters (keysetId -> counter) */
      keysetCounters: Record<string, number>;
      proofs: CashuProof[];
      /** LIVE handle — not serializable */
      wallet: ExtendedCashuWallet;
    }
  | {
      type: 'spark';
      balance: Money | null;
      network: SparkNetwork;
      /** LIVE Breez SDK instance */
      wallet: BreezSdk;
    }
);

// ---- Derivations (master verbatim) ----

type DistributedOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type ExtendedAccount<T extends AccountType = AccountType> = Extract<
  Account,
  { type: T }
> & { isDefault: boolean };

export type CashuAccount = Extract<Account, { type: 'cashu' }>;
export type SparkAccount = Extract<Account, { type: 'spark' }>;
/** Server-safe — no decryptable proofs */
export type RedactedAccount = DistributedOmit<Account, 'proofs'>;

// ---- Add account config ----

export type AddAccountConfig =
  | { type: 'cashu'; mintUrl: string; currency: Currency; name?: string }
  | { type: 'spark'; currency: Currency; name?: string };
