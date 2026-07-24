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

/** Thrown when a namespace method requiring an authenticated session runs without one. */
export class NoSessionError extends SdkError {
  constructor() {
    super('No authenticated session');
    this.name = 'NoSessionError';
  }
}

/** Thrown when a method is called on an SDK instance that has been disposed. */
export class DisposedError extends SdkError {
  constructor() {
    super('The SDK instance has been disposed');
    this.name = 'DisposedError';
  }
}

/**
 * Thrown when the session an operation belongs to ends (sign-out, a different
 * user's login, or expiry) while the operation is in flight, so its result must
 * not be used. Never retry the same operation — it would run under a session
 * that no longer owns it. Transient, unlike {@link DisposedError}: the instance
 * stays usable, and a fresh operation under the new session is what recovers.
 */
export class SessionEndedError extends SdkError {
  constructor() {
    super('The session ended before the operation completed');
    this.name = 'SessionEndedError';
  }
}

/** Thrown when a namespace is accessed before its migration slice has landed. */
export class NotImplementedError extends SdkError {
  constructor(namespace: string) {
    super(`${namespace} is not implemented yet.`);
    this.name = 'NotImplementedError';
  }
}
