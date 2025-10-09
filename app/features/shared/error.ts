export const getErrorMessage = (
  error: unknown,
  fallbackMessage = 'Unknown error. Please try again or contact support',
) => {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
};

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

export const accountOfflineToast = {
  title: 'Account Offline',
  description:
    'This account is currently offline. Please select a different account.',
  variant: 'destructive' as const,
};
