import type { Currency, Money } from '@agicash/money';
import type { AccountsDomain } from '../../domains';
import { DomainError, SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { checkIsTestMint } from '../../internal/lib/cashu';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { UserRepository } from '../../internal/repositories/user-repository';
import type { Account } from '../../types/account';
import type { AddAccountConfig } from '../../types/account-config';
import type { PaymentIntent } from '../../types/scan';
import type { DomainContext } from '../context';
import { getAccountBalance } from './account-utils';
import { suggestForAccounts } from './suggest';

/** Build the accounts domain over the shared context + the account repository. */
export function createAccountsDomain(
  ctx: DomainContext,
  accounts: AccountRepository,
): AccountsDomain {
  const users = new UserRepository(ctx.connections.supabase);

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  const sparkNetworkFromConfig = (): 'MAINNET' | 'REGTEST' => {
    const sparkDefault = ctx.config.defaultAccounts?.find(
      (a) => a.type === 'spark' && a.currency === 'BTC',
    );
    return sparkDefault && sparkDefault.type === 'spark'
      ? sparkDefault.network
      : 'MAINNET';
  };

  return {
    async list() {
      return accounts.getAllActive(await requireUserId());
    },

    get(id: string) {
      return accounts.get(id);
    },

    async getDefault(params?: { currency?: Currency }) {
      const userId = await requireUserId();
      const user = await users.get(userId);
      if (!user) return null;
      const currency = params?.currency ?? user.defaultCurrency;
      const defaultId =
        currency === 'BTC'
          ? user.defaultBtcAccountId
          : user.defaultUsdAccountId;
      if (!defaultId) return null;
      return accounts.get(defaultId);
    },

    async add(config: AddAccountConfig) {
      const userId = await requireUserId();
      let created: Account;
      if (config.type === 'cashu') {
        created = await accounts.create({
          userId,
          type: 'cashu',
          name: config.name ?? 'Cashu',
          currency: config.currency,
          purpose: config.purpose ?? 'transactional',
          expiresAt: config.expiresAt ?? null,
          mintUrl: config.mintUrl,
          isTestMint: checkIsTestMint(config.mintUrl),
        });
      } else {
        created = await accounts.create({
          userId,
          type: 'spark',
          name: config.name ?? 'Spark',
          currency: config.currency,
          purpose: 'transactional',
          expiresAt: null,
          network: sparkNetworkFromConfig(),
        });
      }
      ctx.emitter.emit('account:updated', { account: created, op: 'created' });
      return created;
    },

    async setDefault(account: Account) {
      if (account.currency !== 'BTC' && account.currency !== 'USD') {
        throw new DomainError('Unsupported currency', 'UNSUPPORTED_CURRENCY');
      }
      const userId = await requireUserId();
      const user = await users.get(userId);
      if (!user) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
      const updated = await users.update(userId, {
        defaultBtcAccountId:
          account.currency === 'BTC' ? account.id : user.defaultBtcAccountId,
        defaultUsdAccountId:
          account.currency === 'USD' ? account.id : user.defaultUsdAccountId,
      });
      ctx.emitter.emit('user:updated', { user: updated });
    },

    async getBalance(account: Account): Promise<Money> {
      const balance = getAccountBalance(account);
      if (!balance) {
        throw new DomainError(
          'Account balance is unavailable (offline)',
          'ACCOUNT_OFFLINE',
        );
      }
      return balance;
    },

    suggestFor(intent: PaymentIntent, accountList: Account[]) {
      return Promise.resolve(suggestForAccounts(intent, accountList));
    },
  };
}
