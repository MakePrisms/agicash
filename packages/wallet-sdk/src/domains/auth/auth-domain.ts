import type { AuthDomain } from '../../domains';
import { SessionExpiryScheduler } from '../../internal/auth/session-expiry-scheduler';
import {
  osChangePassword,
  osConfirmPasswordReset,
  osConvertGuestToUserAccount,
  getCurrentUserId as osGetCurrentUserId,
  osHandleGoogleCallback,
  osInitiateGoogleAuth,
  isLoggedIn as osIsLoggedIn,
  osRefreshAccessToken,
  osRequestNewVerificationCode,
  osRequestPasswordReset,
  osSignIn,
  osSignInGuest,
  osSignOut,
  osSignUp,
  osSignUpGuest,
  osVerifyEmail,
} from '../../internal/connections/open-secret';
import { generateRandomPassword } from '../../internal/crypto/password';
import { sha256Hex } from '../../internal/crypto/sha256';
import type { User } from '../../types/user';
import type { DomainContext } from '../context';
import {
  type ResolveSessionOptions,
  resolveSessionRequired,
} from '../user/session-resolver';
import { GuestCredentialStore } from './guest-storage';

type SessionExpiryDecisionDeps = {
  /** Whether the current session belongs to a guest (silently re-extendable). */
  isGuest: () => Promise<boolean>;
  /** Silently re-extend the guest session (re-runs the guest sign-in flow). */
  reExtendGuest: () => Promise<void>;
  /** Emit `auth:session-expired` (terminal — only on a real expiry). */
  emitExpired: () => void;
  /** Stop the expiry timer. */
  disarm: () => void;
};

/**
 * Decide what to do when the refresh token is about to expire.
 *
 * Guests are silently re-extended (success re-arms the scheduler via the
 * `auth:signed-in` the re-extend emits, so we do NOT emit here). Full accounts
 * — and guests whose re-extend fails — disarm and emit `auth:session-expired`
 * exactly once. Pure/DI'd so both branches are unit-testable without OpenSecret.
 */
export async function handleSessionExpiry(
  deps: SessionExpiryDecisionDeps,
): Promise<void> {
  if (await deps.isGuest()) {
    try {
      await deps.reExtendGuest();
      return;
    } catch (error) {
      console.error('guest session re-extend failed', { cause: error });
    }
  }
  deps.disarm();
  deps.emitExpired();
}

/** Build the auth domain over the shared context. */
export function createAuthDomain(ctx: DomainContext): AuthDomain {
  const guest = new GuestCredentialStore(ctx.config.storage);

  const signedIn = async (options?: ResolveSessionOptions): Promise<User> => {
    const user = await resolveSessionRequired(ctx, options);
    ctx.emitter.emit('auth:signed-in', { user });
    return user;
  };

  const sessionExpiry = ctx.config.sessionExpiry;
  const scheduler = new SessionExpiryScheduler({
    storage: ctx.config.storage,
    onExpiry: () => {
      void handleSessionExpiry({
        isGuest: async () => (await guest.get()) !== null,
        reExtendGuest: () => domain.signInGuest().then(() => undefined),
        emitExpired: () => ctx.emitter.emit('auth:session-expired', {}),
        disarm: () => scheduler.disarm(),
      });
    },
    now: sessionExpiry?.now,
    setTimer: sessionExpiry?.setTimer,
    clearTimer: sessionExpiry?.clearTimer,
  });

  ctx.emitter.on('auth:signed-in', () => {
    void scheduler.armIfLoggedIn();
  });
  ctx.emitter.on('auth:signed-out', () => {
    scheduler.disarm();
  });

  const domain: AuthDomain = {
    async signIn({ email, password }) {
      await osSignIn(email, password);
      return signedIn();
    },
    async signUp({
      email,
      password,
      termsAcceptedAt,
      giftCardMintTermsAcceptedAt,
    }) {
      await osSignUp(email, password, '');
      return signedIn({ termsAcceptedAt, giftCardMintTermsAcceptedAt });
    },
    async signInGuest(params = {}) {
      const existing = await guest.get();
      if (existing) {
        await osSignInGuest(existing.id, existing.password);
      } else {
        const password = generateRandomPassword(32);
        const { id } = await osSignUpGuest(password, '');
        await guest.store({ id, password });
      }
      return signedIn(params);
    },
    async signOut() {
      await osSignOut();
      ctx.emitter.emit('auth:signed-out', {});
    },
    async refresh() {
      await osRefreshAccessToken();
    },
    async resetPassword(email) {
      const secret = generateRandomPassword(20);
      const hashedSecret = await sha256Hex(secret);
      await osRequestPasswordReset(email, hashedSecret);
      return { secret };
    },
    async confirmPasswordReset({ email, code, secret, newPassword }) {
      await osConfirmPasswordReset(email, code, secret, newPassword);
    },
    async changePassword({ current, new: newPassword }) {
      await osChangePassword(current, newPassword);
    },
    async upgradeGuest({ email, password }) {
      await osConvertGuestToUserAccount(email, password);
      await guest.clear();
      return signedIn();
    },
    async beginGoogleSignIn() {
      const { auth_url } = await osInitiateGoogleAuth('');
      return { authUrl: auth_url };
    },
    async completeOAuth({
      code,
      state,
      termsAcceptedAt,
      giftCardMintTermsAcceptedAt,
    }) {
      await osHandleGoogleCallback(code, state, '');
      return signedIn({ termsAcceptedAt, giftCardMintTermsAcceptedAt });
    },
    async verifyEmail(code) {
      await osVerifyEmail(code);
      const user = await resolveSessionRequired(ctx);
      ctx.emitter.emit('user:updated', { user });
      return user;
    },
    async requestEmailVerificationCode() {
      await osRequestNewVerificationCode();
    },
    isLoggedIn() {
      return osIsLoggedIn(ctx.config.storage);
    },
    getCurrentUserId() {
      return osGetCurrentUserId(ctx.config.storage);
    },
  };

  void scheduler.armIfLoggedIn();

  return domain;
}
