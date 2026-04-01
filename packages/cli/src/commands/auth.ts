import { isConfigured } from '@agicash/opensecret-sdk';
import type { ParsedArgs } from '../args';

export type AuthResult = {
  action: string;
  user?: {
    id: string;
    email?: string;
    name?: string | null;
    emailVerified?: boolean;
    loginMethod?: string;
  };
  error?: string;
  code?: string;
};

const VALID_SUBCOMMANDS = ['login', 'signup', 'logout', 'status'] as const;

/**
 * Pure arg validation — no SDK dependency. Tests use this directly.
 */
export function validateAuthArgs(args: ParsedArgs): AuthResult {
  const subcommand = args.positional[0];

  if (!subcommand) {
    return {
      action: 'error',
      error: 'Usage: agicash auth <login|signup|logout|status>',
      code: 'MISSING_SUBCOMMAND',
    };
  }

  if (
    !VALID_SUBCOMMANDS.includes(
      subcommand as (typeof VALID_SUBCOMMANDS)[number],
    )
  ) {
    return {
      action: 'error',
      error: `Unknown auth subcommand: ${subcommand}. Use: login, signup, logout, status`,
      code: 'UNKNOWN_SUBCOMMAND',
    };
  }

  if (subcommand === 'login' || subcommand === 'signup') {
    if (!args.positional[1]) {
      return {
        action: 'error',
        error: `Usage: agicash auth ${subcommand} <email> <password>`,
        code: 'MISSING_EMAIL',
      };
    }
    if (!args.positional[2]) {
      return {
        action: 'error',
        error: `Usage: agicash auth ${subcommand} <email> <password>`,
        code: 'MISSING_PASSWORD',
      };
    }
  }

  return { action: 'validated' };
}

/**
 * Full validation: args + OpenSecret config check.
 * Called from main.ts before executeAuthCommand().
 */
export function handleAuthCommand(args: ParsedArgs): AuthResult {
  const argsResult = validateAuthArgs(args);
  if (argsResult.action === 'error') return argsResult;

  if (!isConfigured()) {
    return {
      action: 'error',
      error:
        'OpenSecret not configured. Set OPENSECRET_CLIENT_ID in your .env file.',
      code: 'NOT_CONFIGURED',
    };
  }

  return { action: 'validated' };
}
