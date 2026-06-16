import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import {
  canReceiveFromLightning,
  canSendToLightning,
  getAccountBalance,
  getExtendedAccounts,
  isDefaultAccount,
} from './account-utils';
import type { Account } from '../../types/account';
import type { User } from '../../types/user';

const cashu = (over: Partial<Account> = {}): Account =>
  ({
    id: 'c1',
    name: 'USD',
    type: 'cashu',
    currency: 'USD',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    createdAt: 't',
    version: 1,
    expiresAt: null,
    mintUrl: 'https://m.test',
    isTestMint: false,
    keysetCounters: {},
    proofs: [{ amount: 50 } as never, { amount: 70 } as never],
    wallet: {
      getMintInfo: () => ({ isSupported: () => ({ disabled: false }) }),
    } as never,
    ...over,
  }) as Account;

const spark: Account = {
  id: 's1',
  name: 'BTC',
  type: 'spark',
  currency: 'BTC',
  purpose: 'transactional',
  state: 'active',
  isOnline: true,
  createdAt: 't',
  version: 1,
  expiresAt: null,
  balance: new Money({ amount: 1000, currency: 'BTC', unit: 'sat' }),
  network: 'MAINNET',
  wallet: {} as never,
} as Account;

const user = {
  defaultBtcAccountId: 's1',
  defaultUsdAccountId: 'c1',
} as User;

describe('account-utils', () => {
  it('getAccountBalance sums cashu proofs', () => {
    expect(getAccountBalance(cashu())?.toString()).toBe(
      new Money({ amount: 120, currency: 'USD', unit: 'cent' }).toString(),
    );
  });

  it('getAccountBalance returns spark balance', () => {
    expect(getAccountBalance(spark)?.toString()).toBe(
      (spark as Extract<Account, { type: 'spark' }>).balance?.toString(),
    );
  });

  it('canSendToLightning: spark true; test mint false; offline false', () => {
    expect(canSendToLightning(spark)).toBe(true);
    expect(canSendToLightning(cashu({ isTestMint: true } as never))).toBe(false);
    expect(canSendToLightning(cashu({ isOnline: false } as never))).toBe(false);
    expect(canSendToLightning(cashu())).toBe(true);
  });

  it('canReceiveFromLightning gates on NUT-04 + flags', () => {
    expect(canReceiveFromLightning(spark)).toBe(true);
    expect(
      canReceiveFromLightning(
        cashu({
          wallet: {
            getMintInfo: () => ({ isSupported: () => ({ disabled: true }) }),
          },
        } as never),
      ),
    ).toBe(false);
  });

  it('isDefaultAccount + getExtendedAccounts tag and sort defaults first', () => {
    expect(isDefaultAccount(user, spark)).toBe(true);
    const ext = getExtendedAccounts(user, [cashu({ id: 'other' } as never), spark]);
    expect(ext[0]?.isDefault).toBe(true);
  });
});
