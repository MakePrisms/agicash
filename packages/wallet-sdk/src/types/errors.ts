// SDK error hierarchy

export class SdkError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
  }
}

/** Transient/stale conflict — caller (or orchestrator) should refetch + retry. */
export class ConcurrencyError extends SdkError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'ConcurrencyError';
  }
}

/** User-facing error — never retry. Surface message directly to the user. */
export class DomainError extends SdkError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'DomainError';
  }
}

/** Entity not found. */
export class NotFoundError extends SdkError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'NotFoundError';
  }
}

/**
 * Pure error classifier — consumed by both the SDK orchestrator and web hooks.
 * Keeps to the four-bucket contract (gudnuf 5/21).
 */
export declare function classify(
  err: unknown,
): 'transient' | 'permanent' | 'already-resolved' | 'unhandled';
