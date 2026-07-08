import { SdkError } from '../error';

/**
 * Thrown when `WebAssembly` is not available in the current browser session.
 * Most commonly caused by iOS Lockdown Mode disabling WASM in WebKit; can also
 * occur in restricted in-app WebViews on Android.
 */
export class WebAssemblyUnavailableError extends SdkError {
  constructor() {
    super('WebAssembly is not available in this browser session');
    this.name = 'WebAssemblyUnavailableError';
  }
}

export const isInsufficentBalanceError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) {
    return false;
  }
  const lower = error.message.toLowerCase();
  return (
    lower.includes('insufficient funds') ||
    lower.includes('insufficient balance')
  );
};

export const isInvoiceAlreadyPaidError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) {
    return false;
  }
  const lower = error.message.toLowerCase();
  return lower.includes('preimage request already exists');
};
