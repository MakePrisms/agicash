import { DomainError, SdkError } from '../../errors';
import { fetchUser, isLoggedIn } from '../../internal/connections/open-secret';
import {
  deriveCashuLockingXpub,
  deriveEncryptionPublicKey,
  deriveSparkIdentityPublicKey,
} from '../../internal/crypto/bootstrap-keys';
import {
  type UpsertUserParams,
  UserRepository,
} from '../../internal/repositories/user-repository';
import type { User } from '../../types/user';
import type { DomainContext } from '../context';
import {
  buildDefaultAccountInputs,
  sparkNetworkForBootstrap,
} from './default-accounts';

/** Terms timestamps that ride a sign-up / OAuth into the bootstrap. */
export type ResolveSessionOptions = {
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

type OpenSecretIdentity = {
  id: string;
  email?: string;
  email_verified: boolean;
};

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsertWithRetry(
  repo: UserRepository,
  params: UpsertUserParams,
  sleep: Sleep = realSleep,
): Promise<User> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await repo.upsert(params);
    } catch (error) {
      lastError = error;
      if (error instanceof DomainError) throw error;
      if (attempt === 2) break;
      await sleep(Math.min(500 * 2 ** attempt, 30_000));
    }
  }
  throw lastError;
}

/** True if the wallet user drifted from the OpenSecret identity (email / verified). */
export function hasUserChanged(
  user: User,
  identity: OpenSecretIdentity,
): boolean {
  const identityEmail = identity.email ?? null;
  const userEmail = user.isGuest ? null : user.email;
  return (
    userEmail !== identityEmail ||
    user.emailVerified !== identity.email_verified
  );
}

async function bootstrapUser(
  ctx: DomainContext,
  repo: UserRepository,
  identity: OpenSecretIdentity,
  options: ResolveSessionOptions,
): Promise<User> {
  const defaults = ctx.config.defaultAccounts ?? [];
  const accounts = buildDefaultAccountInputs(defaults);
  const [cashuLockingXpub, encryptionPublicKey, sparkIdentityPublicKey] =
    await Promise.all([
      deriveCashuLockingXpub(ctx.connections.keys),
      deriveEncryptionPublicKey(ctx.connections.keys),
      deriveSparkIdentityPublicKey(
        ctx.connections.keys,
        sparkNetworkForBootstrap(defaults),
      ),
    ]);
  return upsertWithRetry(
    repo,
    {
      id: identity.id,
      email: identity.email ?? null,
      emailVerified: identity.email_verified,
      accounts,
      cashuLockingXpub,
      encryptionPublicKey,
      sparkIdentityPublicKey,
      termsAcceptedAt: options.termsAcceptedAt,
      giftCardMintTermsAcceptedAt: options.giftCardMintTermsAcceptedAt,
    },
    ctx._sleep,
  );
}

/**
 * Resolve the current wallet user (ensure-on-resolve). Returns null when no
 * session is active. Reads the `wallet.users` row by the OpenSecret id; if it is
 * missing or has drifted (email / emailVerified) it derives keys + default
 * accounts and runs `upsert_user_with_accounts`.
 */
export async function resolveSession(
  ctx: DomainContext,
  options: ResolveSessionOptions = {},
): Promise<User | null> {
  if (!(await isLoggedIn(ctx.config.storage))) {
    return null;
  }
  const { user: identity } = await fetchUser();
  const repo = new UserRepository(ctx.connections.supabase);
  const existing = await repo.get(identity.id);
  if (existing && !hasUserChanged(existing, identity)) {
    return existing;
  }
  return bootstrapUser(ctx, repo, identity, options);
}

/** As {@link resolveSession}, but throws if no user resolves (post-auth invariant). */
export async function resolveSessionRequired(
  ctx: DomainContext,
  options: ResolveSessionOptions = {},
): Promise<User> {
  const user = await resolveSession(ctx, options);
  if (!user) {
    throw new SdkError(
      'Session resolution failed after authentication',
      'SESSION_RESOLUTION_FAILED',
    );
  }
  return user;
}
