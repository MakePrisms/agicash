export type BackgroundState = 'stopped' | 'follower' | 'leader' | 'error';

/**
 * Execution is background-only: a host must run `start()` somewhere or
 * nothing moves money. The executing instance may differ from the initiating
 * one (the leader lock is per-user across devices).
 */
export type BackgroundApi = {
  /**
   * Leader election + processors.
   * @throws {SdkError} when no authenticated session exists.
   */
  start(): void;
  /**
   * Stops claiming new work immediately, awaits in-flight iterations to their
   * next checkpoint (bounded by a timeout), releases the leader lock, and
   * abandons the remaining queue.
   */
  stop(): Promise<void>;
  readonly state: BackgroundState;
};
