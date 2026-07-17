import type { Account, CashuAccount, SparkAccount } from '../accounts/account';

// The public account types are the domain entities for now: only the apps
// consume the SDK and they just read these shapes, so fields like proofs,
// keysetCounters, and wallet ride along until a later slice narrows the surface
// (#1164). Cashu accounts carry no balance field — consumers sum the exposed
// proofs (getAccountBalance does this).
export type { Account, CashuAccount, SparkAccount };

export type AccountsApi = {
  get(id: string): Promise<Account | null>;
  /** Active accounts of the current user. */
  list(): Promise<Account[]>;
  cashu: {
    add(params: AddCashuAccountParams): Promise<CashuAccount>;
  };
};

export type AddCashuAccountParams = unknown; // step 6 (accounts)
