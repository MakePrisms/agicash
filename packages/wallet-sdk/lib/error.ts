export class UniqueConstraintError extends Error {}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ConcurrencyError extends Error {
  constructor(
    message: string,
    public details: string | undefined = undefined,
  ) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}
