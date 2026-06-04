// Account domain types — master verbatim (app/features/accounts/account.ts)
// Note: `wallet` fields hold LIVE handles (not serializable).
//
// The live-handle + proof sub-field types are RESOLVED to their real implementations in
// Slice 3 (PR5a — the live account-handle resolver): `ExtendedCashuWallet` / `BreezSdk` are
// the genuine cashu-ts wallet subclass / Breez SDK instance the resolver constructs, and
// `ProofDleq` / `ProofWitness` are cashu-ts `Proof['dleq']` / `Proof['witness']` (so a proof
// decrypted via cashu-ts `ProofSchema` is assignable). The reactive base shipped these as
// opaque placeholders (a `declare abstract class` / a minimal hand-written shape) until the
// resolver that needs the real types landed — exactly the no-cache extraction's Slice-0/3
// `types/dependencies.ts` resolution, in-place in this module.

import type { BreezSdk as BreezSdkType } from '@agicash/breez-sdk-spark';
import type { Proof } from '@cashu/cashu-ts';
// The live `ExtendedCashuWallet` is the SDK-internal cashu-ts wallet subclass; it now lives
// IN the package at `../lib/cashu/utils` (relocated out of the web app) — same module
// `internal/lib-cashu-wallet.ts` re-exports. Importing the TYPE here keeps `Account.wallet`
// correctly typed without `types/` depending on `internal/`.
import type { ExtendedCashuWallet as ExtendedCashuWalletClass } from '../lib/cashu/utils';
import type { Currency, Money } from './money';

export type AccountType = 'cashu' | 'spark';
export type AccountState = 'active' | 'expired';
export type AccountPurpose = 'transactional' | 'gift-card' | 'offer';
export type SparkNetwork = 'MAINNET' | 'REGTEST';

// ---- Cashu proof (app/features/accounts/cashu-account.ts, zod/mini z.infer) ----

/**
 * The `dleq` sub-field of a cashu-ts `Proof` (`SerializedDLEQ`), carried by {@link CashuProof}.
 * Resolved (Slice 3) to cashu-ts `Proof['dleq']` — matches `app/lib/cashu/types.ts#ProofSchema`.
 */
export type ProofDleq = Proof['dleq'];

/**
 * The `witness` sub-field of a cashu-ts `Proof` (P2PK / HTLC / raw), carried by
 * {@link CashuProof}. Resolved (Slice 3) to cashu-ts `Proof['witness']` — matches
 * `app/lib/cashu/types.ts#ProofSchema`.
 */
export type ProofWitness = Proof['witness'];

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

// ---- Live wallet handles (resolved Slice 3 to the real protocol handles) ----

/**
 * Live cashu wallet handle (mint info / keysets / keys / seed) — the per-mint protocol-
 * metadata memo. Resolved (Slice 3) to the real `ExtendedCashuWallet` (cashu-ts `Wallet`
 * subclass) from the SDK-internal `lib/cashu`. LIVE handle, not serializable.
 */
export type ExtendedCashuWallet = ExtendedCashuWalletClass;

/**
 * Live Breez/Spark SDK instance held on a spark `Account`. Resolved (Slice 3) to the real
 * `BreezSdk` from `@agicash/breez-sdk-spark` (a native/WASM package — only the TYPE is
 * imported here; the runtime is dynamically loaded by `internal/spark-wallet.ts`). When the
 * wallet is offline this is a stub that throws on any method call. NOT DB data.
 */
export type BreezSdk = BreezSdkType;

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
