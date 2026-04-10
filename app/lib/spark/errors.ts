/**
 * Checks if an error is an insufficient balance error from the Breez SDK.
 * Phase C validation confirmed: message contains "insufficient funds".
 */
export const isInsufficentBalanceError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    lower.includes('insufficient funds') ||
    lower.includes('insufficient balance')
  );
};

/**
 * Checks if an error indicates the invoice was already paid.
 * Phase C validation confirmed: message contains "preimage request already exists".
 */
export const isInvoiceAlreadyPaidError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) return false;
  return error.message
    .toLowerCase()
    .includes('preimage request already exists');
};
