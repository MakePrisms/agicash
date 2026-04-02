import type { Database } from 'bun:sqlite';
import {
  fetchUser,
  isConfigured,
  signIn,
  signInGuest,
  signOut,
  signUp,
  signUpGuest,
} from '@agicash/opensecret-sdk';
import type { ParsedArgs } from '../args';
import { CONFIG_LOCATION_HINT } from '../runtime-config';

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

const VALID_SUBCOMMANDS = [
  'login',
  'signup',
  'logout',
  'status',
  'whoami',
  'guest',
] as const;

/**
 * Pure arg validation — no SDK dependency. Tests use this directly.
 */
export function validateAuthArgs(args: ParsedArgs): AuthResult {
  const subcommand = args.positional[0];

  if (!subcommand) {
    return {
      action: 'error',
      error: 'Usage: agicash auth <login|signup|logout|status|whoami|guest>',
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
      error: `Unknown auth subcommand: ${subcommand}. Use: login, signup, logout, status, whoami, guest`,
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
      error: `OpenSecret not configured. Set OPENSECRET_CLIENT_ID in ${CONFIG_LOCATION_HINT}.`,
      code: 'NOT_CONFIGURED',
    };
  }

  return { action: 'validated' };
}

/**
 * Executes the auth command after validation.
 * Call handleAuthCommand() first for sync validation,
 * then this function if validation passed.
 * Precondition: handleAuthCommand() returned { action: 'validated' }.
 */
export async function executeAuthCommand(
  args: ParsedArgs,
  db: Database,
): Promise<AuthResult> {
  const subcommand = args.positional[0];

  // Prevent login/signup/guest when already authenticated
  if (
    subcommand === 'login' ||
    subcommand === 'signup' ||
    subcommand === 'guest'
  ) {
    try {
      const { user } = await fetchUser();
      const identity = user.email ?? `guest (${user.id.slice(0, 8)}...)`;
      return {
        action: 'error',
        error: `Already logged in as ${identity}. Run: agicash auth logout`,
        code: 'ALREADY_AUTHENTICATED',
      };
    } catch {
      // Not authenticated — good, proceed with login/signup/guest
    }
  }

  switch (subcommand) {
    case 'login':
    case 'signup': {
      // Safe to assert — handleAuthCommand() validated these exist for login/signup
      const email = args.positional[1] as string;
      const password = args.positional[2] as string;
      return subcommand === 'login'
        ? executeLogin(email, password)
        : executeSignup(email, password);
    }
    case 'logout':
      return executeLogout();
    case 'status':
    case 'whoami':
      return executeStatus();
    case 'guest':
      return executeGuest(db);
    default:
      return {
        action: 'error',
        error: 'Unknown subcommand',
        code: 'UNKNOWN_SUBCOMMAND',
      };
  }
}

async function executeLogin(
  email: string,
  password: string,
): Promise<AuthResult> {
  try {
    const response = await signIn(email, password);
    // SDK auto-stores tokens in StorageProvider
    return {
      action: 'logged_in',
      user: { id: response.id, email: response.email },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Login failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'LOGIN_FAILED',
    };
  }
}

async function executeSignup(
  email: string,
  password: string,
): Promise<AuthResult> {
  try {
    // Empty invite code — same as the web app
    const response = await signUp(email, password, '');
    return {
      action: 'signed_up',
      user: { id: response.id, email: response.email },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Signup failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'SIGNUP_FAILED',
    };
  }
}

async function executeLogout(): Promise<AuthResult> {
  try {
    await signOut();
    return { action: 'logged_out' };
  } catch (err) {
    return {
      action: 'error',
      error: `Logout failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'LOGOUT_FAILED',
    };
  }
}

async function executeStatus(): Promise<AuthResult> {
  try {
    const { user } = await fetchUser();
    return {
      action: 'authenticated',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.email_verified,
        loginMethod: user.login_method,
      },
    };
  } catch (_err) {
    return {
      action: 'not_authenticated',
      error: 'Not logged in. Run: agicash auth login <email> <password>',
      code: 'NOT_AUTHENTICATED',
    };
  }
}

async function executeGuest(db: Database): Promise<AuthResult> {
  try {
    const existingId = db
      .query('SELECT value FROM config WHERE key = ?')
      .get('guest-id') as { value: string } | null;
    const existingPassword = db
      .query('SELECT value FROM config WHERE key = ?')
      .get('guest-password') as { value: string } | null;

    if (existingId && existingPassword) {
      const response = await signInGuest(
        existingId.value,
        existingPassword.value,
      );
      return {
        action: 'guest_logged_in',
        user: { id: response.id, email: undefined },
      };
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const password = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const response = await signUpGuest(password, '');

    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
      'guest-id',
      response.id,
    );
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
      'guest-password',
      password,
    );

    return {
      action: 'guest_logged_in',
      user: { id: response.id, email: undefined },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Guest auth failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'GUEST_AUTH_FAILED',
    };
  }
}
