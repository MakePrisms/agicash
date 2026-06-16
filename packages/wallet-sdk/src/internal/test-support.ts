import type { SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../config';
import type { Database } from './db/database';

type DbResult = { data: unknown; error: unknown };

/**
 * A minimal fake Supabase client for repository/domain unit tests. `from(table)`
 * returns a chainable builder whose `single()`/`maybeSingle()` resolve to
 * `selectResult`; `rpc(name, args)` records the call and resolves to `rpcResult`.
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
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
    b['update'] = (payload: unknown) => {
      opts.calls?.update?.push(payload);
      return updateBuilder();
    };
    b['single'] = terminal;
    b['maybeSingle'] = terminal;
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
