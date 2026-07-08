/**
 * Abstract base for everything the SDK throws — hosts get one `instanceof`
 * check at the boundary. Subclass semantics are contract: `DomainError.message`
 * is the only user-displayable message; `ConcurrencyError` always means retry.
 */
export abstract class SdkError extends Error {}

export class UniqueConstraintError extends SdkError {}

export class NotFoundError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class DomainError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ConcurrencyError extends SdkError {
  constructor(
    message: string,
    public details: string | undefined = undefined,
  ) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}
