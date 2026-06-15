const PROD_DEFAULT_ACCOUNTS = [
  {
    type: 'spark',
    currency: 'BTC',
    name: 'Bitcoin',
    network: 'MAINNET',
    isDefault: true,
    purpose: 'transactional',
    expiresAt: null,
  },
] as const;

const TEST_DEFAULT_ACCOUNTS = [
  {
    type: 'cashu',
    currency: 'BTC',
    name: 'Testnut BTC',
    mintUrl: 'https://testnut.cashu.space',
    isTestMint: true,
    isDefault: false,
    purpose: 'transactional',
    expiresAt: null,
  },
  {
    type: 'cashu',
    currency: 'USD',
    name: 'Testnut USD',
    mintUrl: 'https://testnut.cashu.space',
    isTestMint: true,
    isDefault: true,
    purpose: 'transactional',
    expiresAt: null,
  },
] as const;

/** Default accounts seeded at user creation. `includeTestAccounts` (from
 * SdkConfig) replaces the app's `import.meta.env.MODE === 'development'` branch. */
export function getDefaultAccounts(includeTestAccounts: boolean) {
  return includeTestAccounts
    ? [...PROD_DEFAULT_ACCOUNTS, ...TEST_DEFAULT_ACCOUNTS]
    : [...PROD_DEFAULT_ACCOUNTS];
}

export type DefaultAccountInput = ReturnType<typeof getDefaultAccounts>[number];
