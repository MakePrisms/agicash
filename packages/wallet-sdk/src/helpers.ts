// Exported pure helpers

/**
 * Returns the CashApp deep-link URL for a Lightning payment request.
 * Pure — the amount is already encoded in the invoice.
 */
export declare function cashAppDeepLink(paymentRequest: string): string;
