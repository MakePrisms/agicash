import type { BackgroundState, SdkEventMap } from '../../events';
import type { SdkEventEmitter } from '../event-emitter';

export type BackgroundRunnerDeps = {
  lockRepository: {
    takeLead(userId: string, clientId: string): Promise<boolean>;
  };
  taskLoop: { runOnce(): Promise<void>; dispose(): void };
  forwarder: {
    start(userId: string): Promise<void>;
    stop(): Promise<void>;
    setConnectivity(params: { online: boolean; active: boolean }): void;
  };
  registerBalanceListeners: (userId: string) => Promise<() => void>;
  getUserId: () => Promise<string | null>;
  clientId: string;
  emitter: SdkEventEmitter<SdkEventMap>;
  pollIntervalMs?: number;
};

/**
 * Auth-lifecycle background engine: on `start()` it subscribes the realtime
 * forwarder + per-account spark balance listeners (always-on, not leader-gated),
 * then polls `take_lead` every `pollIntervalMs` (default 5s). On each tick, when it
 * holds the lead it runs one `TaskLoop` pass; when it loses the lead it disposes the
 * loop's spark listeners and processes nothing. No connectivity seam (spec D10).
 */
export class BackgroundRunner {
  private currentState: BackgroundState = 'stopped';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private userId: string | null = null;
  private balanceCleanup: (() => void) | null = null;

  constructor(private readonly deps: BackgroundRunnerDeps) {}

  state(): BackgroundState {
    return this.currentState;
  }

  setConnectivity(params: { online: boolean; active: boolean }): void {
    this.deps.forwarder.setConnectivity(params);
  }

  async start(): Promise<void> {
    if (this.currentState !== 'stopped') return;
    this.setState('starting');
    const userId = await this.deps.getUserId();
    if (!userId) return; // stays 'starting'; the consumer should call stop() then start() once authed
    this.userId = userId;

    await this.deps.forwarder.start(userId);
    this.balanceCleanup = await this.deps.registerBalanceListeners(userId);

    await this.runTick();
    this.intervalId = setInterval(() => {
      void this.runTick().catch((error) =>
        console.error('background tick failed', { cause: error }),
      );
    }, this.deps.pollIntervalMs ?? 5000);
  }

  async runTick(): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping')
      return;
    if (!this.userId) return;

    let isLeader = false;
    try {
      isLeader = await this.deps.lockRepository.takeLead(
        this.userId,
        this.deps.clientId,
      );
    } catch (error) {
      // FK errors before the user row exists, transient RPC failures — log + retry next tick.
      console.warn('take_lead failed; retrying next tick', { cause: error });
      isLeader = false;
    }

    if (isLeader) {
      this.setState('leader');
      await this.deps.taskLoop.runOnce();
    } else {
      if (this.currentState === 'leader') this.deps.taskLoop.dispose();
      this.setState('follower');
    }
  }

  async stop(): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping')
      return;
    this.setState('stopping');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.deps.taskLoop.dispose();
    this.balanceCleanup?.();
    this.balanceCleanup = null;
    await this.deps.forwarder.stop();
    this.userId = null;
    this.setState('stopped');
  }

  private setState(state: BackgroundState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.deps.emitter.emit('background:state', { state });
  }
}
