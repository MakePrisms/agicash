import type { AuthDomain } from '../../domains';
import {
  osChangePassword,
  osConfirmPasswordReset,
  osConvertGuestToUserAccount,
  osHandleGoogleCallback,
  osInitiateGoogleAuth,
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

/** Build the auth domain over the shared context. */
export function createAuthDomain(ctx: DomainContext): AuthDomain {
  const guest = new GuestCredentialStore(ctx.config.storage);

  const signedIn = async (options?: ResolveSessionOptions): Promise<User> => {
    const user = await resolveSessionRequired(ctx, options);
    ctx.emitter.emit('auth:signed-in', { user });
    return user;
  };

  return {
    async signIn({ email, password }) {
      await osSignIn(email, password);
      return signedIn();
    },
    async signUp({ email, password, termsAcceptedAt, giftCardMintTermsAcceptedAt }) {
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
    async completeOAuth({ code, state, termsAcceptedAt, giftCardMintTermsAcceptedAt }) {
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
  };
}
