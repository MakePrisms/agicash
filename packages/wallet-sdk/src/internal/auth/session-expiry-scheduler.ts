import type { StorageProvider } from '@agicash/opensecret';
import { decodeJwtExp } from '../connections/open-secret';

const MAX_TIMER_MS = 2_147_483_647; // 2^31 - 1; longer setTimeout delays overflow and fire immediately
const DEFAULT_MARGIN_MS = 5_000; // fire 5s before exp (matches the web's getRemainingSessionTimeInMs)

export type SessionExpirySchedulerDeps = {
  storage: StorageProvider;
  /** Invoked once when the refresh token is about to expire. The auth domain decides guest-extend vs emit. */
  onExpiry: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  marginMs?: number;
};

/**
 * Per-instance timer that fires `onExpiry` shortly before the persisted refresh token expires.
 * Dumb by design: it only decides WHEN. It is re-armed by the auth domain after a successful
 * guest re-extend (the rotated token has a new exp). Chains timers for refresh lifetimes beyond
 * setTimeout's ~24.8-day ceiling.
 */
export class SessionExpiryScheduler {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly setTimer: (
    fn: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly marginMs: number;

  constructor(private readonly deps: SessionExpirySchedulerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));
    this.marginMs = deps.marginMs ?? DEFAULT_MARGIN_MS;
  }

  async armIfLoggedIn(): Promise<void> {
    this.disarm();
    const refreshToken =
      await this.deps.storage.persistent.getItem('refresh_token');
    if (!refreshToken) return;
    const exp = decodeJwtExp(refreshToken);
    if (exp === undefined) return;
    const fireAt = exp * 1000 - this.marginMs;
    this.scheduleAt(fireAt);
  }

  disarm(): void {
    if (this.handle !== null) {
      this.clearTimer(this.handle);
      this.handle = null;
    }
  }

  private scheduleAt(fireAtMs: number): void {
    const remaining = Math.max(fireAtMs - this.now(), 0);
    if (remaining > MAX_TIMER_MS) {
      // chain: wait the max safe slice, then re-evaluate against the same absolute fire time
      this.handle = this.setTimer(
        () => this.scheduleAt(fireAtMs),
        MAX_TIMER_MS,
      );
      return;
    }
    this.handle = this.setTimer(() => {
      this.handle = null;
      this.deps.onExpiry();
    }, remaining);
  }
}
