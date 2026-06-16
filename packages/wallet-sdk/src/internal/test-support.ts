import type { SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../config';
import type { Database } from './db/database';

type DbResult = { data: unknown; error: unknown };

/**
 * A minimal fake Supabase client for repository/domain unit tests. `from(table)`
 * returns a chainable builder whose `single()`/`maybeSingle()` resolve to
 * `selectResult` for `select` chains and to `updateResult` after `update()`;
 * `rpc(name, args)` records the call and resolves to `rpcResult`.
 */
export function makeFakeDb(opts: {
  selectResult?: DbResult;
  updateResult?: DbResult;
  rpcResult?: DbResult;
  calls?: {
    from?: string[];
    update?: unknown[];
    rpc?: Array<{ name: string; args: unknown }>;
  };
}): SupabaseClient<Database> {
  const select = opts.selectResult ?? { data: null, error: null };
  const update = opts.updateResult ?? { data: null, error: null };
  const updateBuilder = () => builder(async () => update);
  function builder(terminal: () => Promise<DbResult>) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'abortSignal']) b[m] = () => b;
    b.insert = () => builder(terminal);
    b.update = (payload: unknown) => {
      opts.calls?.update?.push(payload);
      return updateBuilder();
    };
    b.single = terminal;
    b.maybeSingle = terminal;
    // Allow `await query` without a terminal (.single/.maybeSingle) — needed by
    // getAllActive which awaits the builder directly.
    b.then = (resolve: (v: DbResult) => unknown, reject: (e: unknown) => unknown) =>
      terminal().then(resolve, reject);
    return b;
  }
  return {
    from: (table: string) => {
      opts.calls?.from?.push(table);
      return builder(async () => select);
    },
    rpc: async (name: string, args: unknown) => {
      opts.calls?.rpc?.push({ name, args });
      return opts.rpcResult ?? { data: null, error: null };
    },
  } as unknown as SupabaseClient<Database>;
}

/** An in-memory `StorageProvider` (persistent + session share one map). */
export function inMemoryStorage(
  seed: Record<string, string> = {},
): SdkConfig['storage'] {
  const map = new Map<string, string>(Object.entries(seed));
  const kv = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return { persistent: kv, session: kv } as unknown as SdkConfig['storage'];
}

/** Build a fake JWT carrying the given claims (header/sig are dummy). */
export function jwtWith(claims: { sub?: string; exp?: number }): string {
  return `h.${btoa(JSON.stringify(claims)).replace(/=/g, '')}.s`;
}

/**
 * A COMPLETE `@agicash/opensecret` mock module — every name `open-secret.ts`
 * imports or re-exports — so importing the connection module never throws
 * "Export named X not found". Merge `overrides` to customize specific functions.
 */
export function openSecretModuleMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const noop = async () => undefined;
  return {
    configure: () => {},
    generateThirdPartyToken: async () => ({ token: 'tok' }),
    getPrivateKey: async () => ({ mnemonic: 'm' }),
    getPrivateKeyBytes: async () => ({ private_key: '00'.repeat(32) }),
    getPublicKey: async () => ({
      public_key: '00'.repeat(32),
      algorithm: 'schnorr',
    }),
    signIn: noop,
    signUp: noop,
    signInGuest: noop,
    signUpGuest: noop,
    signOut: noop,
    convertGuestToUserAccount: noop,
    initiateGoogleAuth: noop,
    handleGoogleCallback: noop,
    requestPasswordReset: noop,
    confirmPasswordReset: noop,
    verifyEmail: noop,
    requestNewVerificationCode: noop,
    changePassword: noop,
    refreshAccessToken: async () => ({ access_token: 'a', refresh_token: 'r' }),
    fetchUser: async () => ({ user: { id: 'u1', email_verified: false } }),
    ...overrides,
  };
}

/**
 * A COMPLETE `@agicash/breez-sdk-spark` mock module — every name `breez.ts`
 * imports. `defaultExternalSigner().identityPublicKey().bytes` defaults to
 * `[7]` (hex `07`). Merge `overrides` to customize.
 */
export function breezModuleMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    default: async () => {},
    connect: async () => ({}),
    defaultConfig: () => ({}),
    initLogging: async () => {},
    defaultExternalSigner: () => ({
      identityPublicKey: () => ({ bytes: new Uint8Array([7]) }),
    }),
    ...overrides,
  };
}
