import { computeSHA256 } from '@agicash/ecies';
import { jwtDecode } from 'jwt-decode';
import type { StorageAdapter } from '../config';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type { KeyService } from '../internal/keys';
import type { AuthUser, OpenSecret } from '../internal/opensecret';
import { generateRandomPassword } from '../internal/random-password';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '../internal/timeout';
import { getDefaultAccounts } from '../internal/db/default-accounts';
import type { WriteUserRepository } from '../internal/db/user-repository';
import type { User } from './user-types';

type SparkNetwork = 'MAINNET' | 'REGTEST';
type GuestCredentials = { id: string; password: string };

const GUEST_ACCOUNT_KEY = 'agicash.guest-account';
const REFRESH_TOKEN_KEY = 'refresh_token';
// Treat the session as expired 5s early, matching the app.
const EXPIRY_SKEW_MS = 5_000;

export type AuthDeps = {
  os: OpenSecret;
  keys: KeyService;
  events: EventBus<SdkCoreEventMap>;
  /** Durable host store (auth tokens live here via Open Secret; we also keep guest creds here). */
  storage: StorageAdapter;
  writeUserRepo: WriteUserRepository;
  /** Cleared on sign-out so the next request re-mints a Supabase token. */
  sessionToken: { clear(): void };
  /** Drops the enclave session material on sign-out. */
  storageSession: { clearSession(): Promise<void> };
  /** Network used to derive the user's Spark identity key (matches the default Spark account). */
  network: SparkNetwork;
  includeTestAccounts: boolean;
};

/**
 * Owns the auth state machine end-to-end (Open Secret sign-in/up/guest/upgrade,
 * email verification, OAuth begin/complete, password change/reset) plus
 * session-expiry handling. Replaces the app's React hooks + the
 * `window.location.reload()` recovery with the `auth:session-expired` event.
 */
export class AuthDomain {
  private expiryTimer: LongTimeout | null = null;

  constructor(private readonly deps: AuthDeps) {}

  /** Arm the expiry timer if a session already exists (called by Sdk.create). */
  async initialize(): Promise<void> {
    await this.scheduleSessionExpiry();
  }

  signIn(p: { email: string; password: string }): Promise<User> {
    return this.deps.os
      .signIn(p.email, p.password)
      .then(() => this.completeSignIn());
  }

  signUp(p: { email: string; password: string }): Promise<User> {
    return this.deps.os
      .signUp(p.email, p.password, '')
      .then(() => this.completeSignIn());
  }

  async signInGuest(): Promise<User> {
    const existing = await this.getGuestCredentials();
    if (existing) {
      await this.deps.os.signInGuest(existing.id, existing.password);
    } else {
      const password = generateRandomPassword(32);
      const { id } = await this.deps.os.signUpGuest(password, '');
      await this.setGuestCredentials({ id, password });
    }
    return this.completeSignIn();
  }

  async upgradeGuest(p: { email: string; password: string }): Promise<User> {
    await this.deps.os.convertGuestToUserAccount(p.email, p.password);
    await this.clearGuestCredentials();
    return this.completeSignIn();
  }

  async signOut(): Promise<void> {
    await this.deps.os.signOut();
    await this.teardownSession();
    this.deps.events.emit('auth:signed-out', {});
  }

  async changePassword(p: { current: string; new: string }): Promise<void> {
    await this.deps.os.changePassword(p.current, p.new);
  }

  async requestEmailVerification(): Promise<void> {
    await this.deps.os.requestNewVerificationCode();
  }

  async verifyEmail(p: { code: string }): Promise<void> {
    await this.deps.os.verifyEmail(p.code);
  }

  async beginGoogle(): Promise<{ authUrl: string }> {
    const { auth_url } = await this.deps.os.initiateGoogleAuth('');
    return { authUrl: auth_url };
  }

  /** Host owns the redirect + pre-OAuth location bookkeeping; it hands back the
   * callback's `code`/`state`. */
  completeOAuth(params: { code: string; state: string }): Promise<User> {
    return this.deps.os
      .handleGoogleCallback(params.code, params.state, '')
      .then(() => this.completeSignIn());
  }

  /** Superset over the spec's AuthDomain — the web app's forgot-password flow needs these. */
  async requestPasswordReset(p: {
    email: string;
  }): Promise<{ email: string; secret: string }> {
    const secret = generateRandomPassword(20);
    const hashedSecret = await computeSHA256(secret);
    await this.deps.os.requestPasswordReset(p.email, hashedSecret);
    return { email: p.email, secret };
  }

  async confirmPasswordReset(p: {
    email: string;
    code: string;
    secret: string;
    newPassword: string;
  }): Promise<void> {
    await this.deps.os.confirmPasswordReset(
      p.email,
      p.code,
      p.secret,
      p.newPassword,
    );
  }

  cancelSessionExpiry(): void {
    if (this.expiryTimer) {
      clearLongTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  // ---- internals ----

  private async completeSignIn(): Promise<User> {
    const { user: authUser } = await this.deps.os.fetchUser();
    const user = await this.ensureUser(authUser);
    await this.scheduleSessionExpiry();
    this.deps.events.emit('auth:signed-in', { user });
    return user;
  }

  /** Derive the user's crypto + upsert the wallet.users row (+ default accounts),
   * returning the reconciled domain User. */
  private async ensureUser(authUser: AuthUser): Promise<User> {
    const [encryptionPublicKey, cashuLockingXpub, sparkIdentityPublicKey] =
      await Promise.all([
        this.deps.keys.getEncryptionPublicKey(),
        this.deps.keys.getCashuLockingXpub(),
        this.deps.keys.getSparkIdentityPublicKey(this.deps.network),
      ]);
    return this.deps.writeUserRepo.upsert({
      id: authUser.id,
      email: authUser.email,
      emailVerified: authUser.email_verified,
      accounts: getDefaultAccounts(this.deps.includeTestAccounts),
      cashuLockingXpub,
      encryptionPublicKey,
      sparkIdentityPublicKey,
    });
  }

  private async teardownSession(): Promise<void> {
    this.cancelSessionExpiry();
    this.deps.keys.clear();
    this.deps.sessionToken.clear();
    await this.deps.storageSession.clearSession();
  }

  private async getGuestCredentials(): Promise<GuestCredentials | null> {
    const raw = await this.deps.storage.get(GUEST_ACCOUNT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GuestCredentials;
    } catch {
      return null;
    }
  }

  private async setGuestCredentials(c: GuestCredentials): Promise<void> {
    await this.deps.storage.set(GUEST_ACCOUNT_KEY, JSON.stringify(c));
  }

  private async clearGuestCredentials(): Promise<void> {
    await this.deps.storage.remove(GUEST_ACCOUNT_KEY);
  }

  private async readRefreshExp(): Promise<number | null> {
    const refresh = await this.deps.storage.get(REFRESH_TOKEN_KEY);
    if (!refresh) return null;
    try {
      const { exp } = jwtDecode<{ exp?: number }>(refresh);
      return exp ?? null;
    } catch {
      return null;
    }
  }

  private async scheduleSessionExpiry(): Promise<void> {
    this.cancelSessionExpiry();
    const exp = await this.readRefreshExp();
    if (!exp) return;
    const msUntilExpiry = Math.max(exp * 1000 - EXPIRY_SKEW_MS - Date.now(), 0);
    this.expiryTimer = setLongTimeout(() => {
      void this.handleSessionExpiry();
    }, msUntilExpiry);
  }

  /** A guest session silently re-authenticates (new tokens, timer rearmed) — no
   * event. A full-user session is torn down and `auth:session-expired` fires so
   * the host can route to sign-in (replacing the app's hard reload). */
  private async handleSessionExpiry(): Promise<void> {
    try {
      const guest = await this.getGuestCredentials();
      if (guest) {
        await this.deps.os.signInGuest(guest.id, guest.password);
        await this.scheduleSessionExpiry();
        return;
      }
    } catch {
      // guest re-auth failed → fall through to expired
    }
    try {
      await this.deps.os.signOut();
    } catch {
      // OS may already have cleared tokens; ignore
    }
    await this.teardownSession().catch(() => {});
    this.deps.events.emit('auth:session-expired', {});
  }
}
