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
