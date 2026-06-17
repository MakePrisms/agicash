/**
 * One leader-gated saga family: the engine calls {@link activate} when this
 * client becomes the leader and {@link deactivate} when it stops being the
 * leader, so the family's observers/trackers/timers only run while leading.
 */
export type SagaProcessor = {
  /** Starts the family's work-set observer + trackers. Idempotent. */
  activate: () => void;
  /** Tears down the family's observers/trackers/timers. Idempotent. */
  deactivate: () => void;
};
