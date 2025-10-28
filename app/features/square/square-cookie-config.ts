/**
 * Shared Square cookie configuration
 * Used by both client and server-side cookie utilities
 */

export const SQUARE_COOKIES = {
  STATE: {
    name: 'square-state',
    maxAge: 600, // 10 minutes
    httpOnly: true,
  },
  MERCHANT_EMAIL: {
    name: 'square-merchant-email',
    maxAge: 600, // 10 minutes
    httpOnly: false,
  },
  CONNECTED: {
    name: 'square-connected',
    maxAge: 86400, // 24 hours
    httpOnly: false,
  },
} as const;
