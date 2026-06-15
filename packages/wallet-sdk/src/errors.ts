/** Base class for all errors thrown across the SDK boundary. */
export class SdkError extends Error {}

/** User-facing error that must never be retried. */
export class DomainError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Transient conflict (optimistic-concurrency clash); always safe to retry. */
export class ConcurrencyError extends SdkError {
  constructor(
    message: string,
    public details: string | undefined = undefined,
  ) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

/** Requested entity does not exist. */
export class NotFoundError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** DB unique-constraint violation (Postgres code 23505). */
export class UniqueConstraintError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'UniqueConstraintError';
  }
}

export const getErrorMessage = (
  error: unknown,
  fallbackMessage = 'Unknown error. Please try again or contact support',
): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return fallbackMessage;
};
