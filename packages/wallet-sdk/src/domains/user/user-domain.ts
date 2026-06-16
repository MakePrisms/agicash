import type { UserDomain } from '../../domains';
import { SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { UserRepository } from '../../internal/repositories/user-repository';
import type { Currency } from '../../types/money';
import type { User } from '../../types/user';
import type { DomainContext } from '../context';
import { resolveSession } from './session-resolver';

/** Build the user domain over the shared context. */
export function createUserDomain(ctx: DomainContext): UserDomain {
  const repo = new UserRepository(ctx.connections.supabase);

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) {
      throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    }
    return id;
  };

  const emitUpdated = (user: User): User => {
    ctx.emitter.emit('user:updated', { user });
    return user;
  };

  return {
    getCurrentUser() {
      return resolveSession(ctx);
    },
    async updateUsername(username: string) {
      const userId = await requireUserId();
      return emitUpdated(await repo.update(userId, { username }));
    },
    async acceptTerms(params: { wallet?: boolean; giftCardMint?: boolean }) {
      const userId = await requireUserId();
      const now = new Date().toISOString();
      return emitUpdated(
        await repo.update(userId, {
          termsAcceptedAt: params.wallet ? now : undefined,
          giftCardMintTermsAcceptedAt: params.giftCardMint ? now : undefined,
        }),
      );
    },
    async setDefaultCurrency(currency: Currency) {
      const userId = await requireUserId();
      return emitUpdated(
        await repo.update(userId, { defaultCurrency: currency }),
      );
    },
  };
}
