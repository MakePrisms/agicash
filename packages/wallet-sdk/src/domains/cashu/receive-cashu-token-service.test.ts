import { describe, expect, it } from 'bun:test';
import type { CashuWalletService } from '../../internal/connections/cashu-wallet';
import type { buildMintValidator } from '../../internal/lib/cashu/mint-validation';
import type {
  Account,
  ExtendedCashuAccount,
  ExtendedSparkAccount,
} from '../../types/account';
import type { ExtendedCashuWallet } from '../../types/dependencies';
import {
  type CashuAccountWithTokenFlags,
  type ReceiveCashuTokenAccount,
  isClaimingToSameCashuAccount,
} from './receive-cashu-token-models';
import { ReceiveCashuTokenService } from './receive-cashu-token-service';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeFakeMintInfo(options: { name?: string; isOnline?: boolean } = {}) {
  return {
    name: options.name ?? 'Test Mint',
    isSupported: (_nut: number) => ({
      supported: false,
      disabled: false,
      params: [],
    }),
    cache: {},
    agicash: undefined,
  } as unknown as ExtendedCashuWallet['getMintInfo'] extends () => infer R
    ? R
    : never;
}

function makeFakeKeyset(
  options: { unit?: string; active?: boolean; finalExpiry?: number } = {},
) {
  return {
    id: 'keyset-1',
    unit: options.unit ?? 'sat',
    active: options.active ?? true,
    final_expiry: options.finalExpiry,
    isActive: options.active ?? true,
    toMintKeyset: () => ({
      id: 'keyset-1',
      unit: options.unit ?? 'sat',
      active: options.active ?? true,
      final_expiry: options.finalExpiry,
    }),
  };
}

function makeFakeWallet(
  options: {
    purpose?: 'transactional' | 'gift-card' | 'offer';
    mintName?: string;
    keysets?: ReturnType<typeof makeFakeKeyset>[];
  } = {},
): ExtendedCashuWallet {
  const {
    purpose = 'transactional',
    mintName = 'Test Mint',
    keysets = [makeFakeKeyset()],
  } = options;

  const mintInfo = makeFakeMintInfo({ name: mintName });

  return {
    purpose,
    getMintInfo: () => mintInfo,
    keyChain: {
      getKeysets: () => keysets,
    },
  } as unknown as ExtendedCashuWallet;
}

function makeFakeCashuWalletService(
  options: {
    wallet?: ExtendedCashuWallet;
    isOnline?: boolean;
  } = {},
): CashuWalletService {
  const { wallet = makeFakeWallet(), isOnline = true } = options;
  return {
    getInitialized: async () => ({ wallet, isOnline }),
  } as unknown as CashuWalletService;
}

function makeFakeMintValidator(
  result: true | string = true,
): ReturnType<typeof buildMintValidator> {
  return () => result;
}

function makeCashuAccountWithTokenFlags(
  overrides: Partial<CashuAccountWithTokenFlags> = {},
): CashuAccountWithTokenFlags {
  const wallet = makeFakeWallet();
  return {
    id: 'acc-cashu-1',
    name: 'My Mint',
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2024-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl: 'https://mint.example.com',
    isTestMint: false,
    keysetCounters: {},
    proofs: [],
    isDefault: false,
    wallet: wallet as unknown as ExtendedCashuAccount['wallet'],
    isSource: true,
    isUnknown: false,
    canReceive: true,
    ...overrides,
  };
}

function makeReceiveCashuTokenAccount(
  overrides: Partial<CashuAccountWithTokenFlags> = {},
): ReceiveCashuTokenAccount {
  return makeCashuAccountWithTokenFlags(overrides) as ReceiveCashuTokenAccount;
}

function makeExtendedCashuAccount(
  overrides: Partial<ExtendedCashuAccount> = {},
): ExtendedCashuAccount {
  const wallet = makeFakeWallet(
    overrides.purpose ? { purpose: overrides.purpose } : {},
  );
  return {
    id: 'acc-cashu-1',
    name: 'My Mint',
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2024-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl: 'https://mint.example.com',
    isTestMint: false,
    keysetCounters: {},
    proofs: [],
    isDefault: false,
    wallet: wallet as unknown as ExtendedCashuAccount['wallet'],
    ...overrides,
  };
}

function makeExtendedSparkAccount(
  overrides: Partial<ExtendedSparkAccount> = {},
): ExtendedSparkAccount {
  return {
    id: 'acc-spark-1',
    name: 'Spark',
    type: 'spark',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2024-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    isDefault: false,
    balance: null,
    network: 'MAINNET',
    wallet: {
      getMintInfo: () => ({
        isSupported: () => ({ supported: false, disabled: false, params: [] }),
      }),
    } as unknown as ExtendedSparkAccount['wallet'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: isClaimingToSameCashuAccount
// ---------------------------------------------------------------------------

describe('isClaimingToSameCashuAccount', () => {
  it('returns true when both accounts are cashu with the same mint and currency', () => {
    const a: Account = makeExtendedCashuAccount({
      mintUrl: 'https://mint.example.com',
      currency: 'BTC',
    });
    const b: Account = makeExtendedCashuAccount({
      mintUrl: 'https://mint.example.com',
      currency: 'BTC',
    });
    expect(isClaimingToSameCashuAccount(a, b)).toBe(true);
  });

  it('returns true when mint URLs differ only in trailing slash', () => {
    const a: Account = makeExtendedCashuAccount({
      mintUrl: 'https://mint.example.com/',
      currency: 'BTC',
    });
    const b: Account = makeExtendedCashuAccount({
      mintUrl: 'https://mint.example.com',
      currency: 'BTC',
    });
    expect(isClaimingToSameCashuAccount(a, b)).toBe(true);
  });

  it('returns false when mints differ', () => {
    const a: Account = makeExtendedCashuAccount({
      mintUrl: 'https://mint1.example.com',
    });
    const b: Account = makeExtendedCashuAccount({
      mintUrl: 'https://mint2.example.com',
    });
    expect(isClaimingToSameCashuAccount(a, b)).toBe(false);
  });

  it('returns false when currencies differ', () => {
    const a: Account = makeExtendedCashuAccount({ currency: 'BTC' });
    const b: Account = makeExtendedCashuAccount({ currency: 'USD' });
    expect(isClaimingToSameCashuAccount(a, b)).toBe(false);
  });

  it('returns false when account a is spark', () => {
    const a: Account = makeExtendedSparkAccount();
    const b: Account = makeExtendedCashuAccount();
    expect(isClaimingToSameCashuAccount(a, b)).toBe(false);
  });

  it('returns false when account b is spark', () => {
    const a: Account = makeExtendedCashuAccount();
    const b: Account = makeExtendedSparkAccount();
    expect(isClaimingToSameCashuAccount(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: getDefaultReceiveAccount (static)
// ---------------------------------------------------------------------------

describe('ReceiveCashuTokenService.getDefaultReceiveAccount', () => {
  it('returns source account when it cannot send to lightning and canReceive is true', () => {
    // test mint → canSendToLightning returns false
    const source = makeCashuAccountWithTokenFlags({
      isTestMint: true,
      canReceive: true,
    });
    const result = ReceiveCashuTokenService.getDefaultReceiveAccount(
      source,
      [],
    );
    expect(result).toBe(source);
  });

  it('returns null when source cannot send to lightning and canReceive is false', () => {
    const source = makeCashuAccountWithTokenFlags({
      isTestMint: true,
      canReceive: false,
    });
    const result = ReceiveCashuTokenService.getDefaultReceiveAccount(
      source,
      [],
    );
    expect(result).toBeNull();
  });

  it('returns preferred account when it canReceive', () => {
    const source = makeCashuAccountWithTokenFlags({
      isTestMint: false,
      canReceive: true,
    });
    const preferred = makeReceiveCashuTokenAccount({
      id: 'preferred-id',
      canReceive: true,
    });
    const other = makeReceiveCashuTokenAccount({
      id: 'other-id',
      canReceive: true,
    });

    const result = ReceiveCashuTokenService.getDefaultReceiveAccount(
      source,
      [preferred, other],
      'preferred-id',
    );
    expect(result).toBe(preferred);
  });

  it('falls through to default account when preferred canReceive is false', () => {
    const source = makeCashuAccountWithTokenFlags({
      isTestMint: false,
      canReceive: true,
    });
    const preferred = makeReceiveCashuTokenAccount({
      id: 'preferred-id',
      canReceive: false,
      isDefault: false,
    });
    const defaultAcc = makeReceiveCashuTokenAccount({
      id: 'default-id',
      canReceive: true,
      isDefault: true,
      currency: 'BTC',
    });

    const result = ReceiveCashuTokenService.getDefaultReceiveAccount(
      source,
      [preferred, defaultAcc],
      'preferred-id',
    );
    expect(result).toBe(defaultAcc);
  });

  it('falls through to source when no preferred/default canReceive', () => {
    const source = makeCashuAccountWithTokenFlags({
      isTestMint: false,
      canReceive: true,
    });
    const other = makeReceiveCashuTokenAccount({
      id: 'other-id',
      canReceive: false,
      isDefault: false,
    });

    const result = ReceiveCashuTokenService.getDefaultReceiveAccount(source, [
      other,
    ]);
    expect(result).toBe(source);
  });

  it('returns null when nothing can receive', () => {
    const source = makeCashuAccountWithTokenFlags({
      isTestMint: false,
      canReceive: false,
    });
    const other = makeReceiveCashuTokenAccount({
      id: 'other-id',
      canReceive: false,
    });

    const result = ReceiveCashuTokenService.getDefaultReceiveAccount(source, [
      other,
    ]);
    expect(result).toBeNull();
  });

  it('default account must match source currency', () => {
    const source = makeCashuAccountWithTokenFlags({
      isTestMint: false,
      canReceive: false,
      currency: 'BTC',
    });
    const wrongCurrencyDefault = makeReceiveCashuTokenAccount({
      id: 'usd-default',
      canReceive: true,
      isDefault: true,
      currency: 'USD',
    });

    // No preferred, default is wrong currency, source can't receive → null
    const result = ReceiveCashuTokenService.getDefaultReceiveAccount(source, [
      wrongCurrencyDefault,
    ]);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: buildAccountForMint
// ---------------------------------------------------------------------------

describe('ReceiveCashuTokenService.buildAccountForMint', () => {
  it('returns canReceive:true when wallet is online and validator passes', async () => {
    const wallet = makeFakeWallet({
      purpose: 'transactional',
      mintName: 'Good Mint',
    });
    const walletService = makeFakeCashuWalletService({
      wallet,
      isOnline: true,
    });
    const service = new ReceiveCashuTokenService(
      walletService,
      makeFakeMintValidator(true),
    );

    const result = await service.buildAccountForMint(
      'https://mint.example.com',
      'BTC',
    );

    expect(result.canReceive).toBe(true);
    expect(result.isOnline).toBe(true);
    expect(result.isSource).toBe(true);
    expect(result.isUnknown).toBe(true);
    expect(result.name).toBe('Good Mint');
  });

  it('returns canReceive:false when validator returns an error string', async () => {
    const wallet = makeFakeWallet({ purpose: 'transactional' });
    const walletService = makeFakeCashuWalletService({
      wallet,
      isOnline: true,
    });
    const service = new ReceiveCashuTokenService(
      walletService,
      makeFakeMintValidator('Mint does not support Lightning'),
    );

    const result = await service.buildAccountForMint(
      'https://mint.example.com',
      'BTC',
    );

    expect(result.canReceive).toBe(false);
    expect(result.isOnline).toBe(true);
  });

  it('returns canReceive:false and isOnline:false when wallet is offline', async () => {
    const wallet = makeFakeWallet({ purpose: 'transactional' });
    const walletService = makeFakeCashuWalletService({
      wallet,
      isOnline: false,
    });
    // Validator should NOT be called in offline case
    let validatorCalled = false;
    const validator: ReturnType<typeof buildMintValidator> = () => {
      validatorCalled = true;
      return true;
    };
    const service = new ReceiveCashuTokenService(walletService, validator);

    const result = await service.buildAccountForMint(
      'https://mint.example.com',
      'BTC',
    );

    expect(result.canReceive).toBe(false);
    expect(result.isOnline).toBe(false);
    expect(validatorCalled).toBe(false);
  });

  it('sets canReceive:false and cannotReceiveReason when offer keyset is expired', async () => {
    // Expiry in the past (Unix epoch 1 = Jan 1970)
    const expiredKeyset = makeFakeKeyset({
      unit: 'sat',
      active: true,
      finalExpiry: 1, // Jan 1970 — definitely expired
    });
    const wallet = makeFakeWallet({
      purpose: 'offer',
      keysets: [expiredKeyset],
    });
    const walletService = makeFakeCashuWalletService({
      wallet,
      isOnline: true,
    });
    const service = new ReceiveCashuTokenService(
      walletService,
      makeFakeMintValidator(true),
    );

    const result = await service.buildAccountForMint(
      'https://mint.example.com',
      'BTC',
    );

    expect(result.canReceive).toBe(false);
    expect(result.cannotReceiveReason).toBe('This offer has expired');
    expect(result.state).toBe('expired');
  });

  it('sets isTestMint:true for known test mint', async () => {
    const wallet = makeFakeWallet({ purpose: 'transactional' });
    const walletService = makeFakeCashuWalletService({
      wallet,
      isOnline: true,
    });
    const service = new ReceiveCashuTokenService(
      walletService,
      makeFakeMintValidator(true),
    );

    const result = await service.buildAccountForMint(
      'https://testnut.cashu.space',
      'BTC',
    );

    expect(result.isTestMint).toBe(true);
  });

  it('passes correct args to the validator', async () => {
    const fakeKeysets = [makeFakeKeyset({ unit: 'sat', active: true })];
    const wallet = makeFakeWallet({
      purpose: 'transactional',
      keysets: fakeKeysets,
    });
    const walletService = makeFakeCashuWalletService({
      wallet,
      isOnline: true,
    });

    let capturedArgs:
      | Parameters<ReturnType<typeof buildMintValidator>>
      | undefined;
    const validator: ReturnType<typeof buildMintValidator> = (...args) => {
      capturedArgs = args;
      return true;
    };

    const service = new ReceiveCashuTokenService(walletService, validator);

    await service.buildAccountForMint('https://mint.example.com', 'BTC');

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs![0]).toBe('https://mint.example.com');
    expect(capturedArgs![1]).toBe('sat'); // getCashuProtocolUnit('BTC') → 'sat'
    // mintInfo and keysets (as MintKeyset[]) are also passed
    expect(capturedArgs![3]).toHaveLength(1);
  });
});
