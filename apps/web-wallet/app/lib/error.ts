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
