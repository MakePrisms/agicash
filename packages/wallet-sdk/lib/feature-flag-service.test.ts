import { describe, expect, mock, test } from 'bun:test';
import type { AgicashDb } from '../db/database';
import {
  FEATURE_FLAG_DEFAULTS,
  configureFeatureFlags,
  getFeatureFlag,
  refreshFeatureFlags,
  resetFeatureFlags,
  subscribeToFeatureFlags,
} from './feature-flag-service';

type RpcResult = { data: unknown; error: unknown };

function makeDb(rpc: ReturnType<typeof mock<() => Promise<RpcResult>>>) {
  return { rpc } as unknown as AgicashDb;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const allOn = { GUEST_SIGNUP: true, DEBUG_LOGGING_SPARK: true };
const allOff = { GUEST_SIGNUP: false, DEBUG_LOGGING_SPARK: false };

// Tests share the module-level store, so order matters: the
// unconfigured/defaults test must run before anything configures or loads.
describe('feature flag store', () => {
  test('reads defaults and rejects refresh before configuration', async () => {
    expect(getFeatureFlag('GUEST_SIGNUP')).toBe(
      FEATURE_FLAG_DEFAULTS.GUEST_SIGNUP,
    );
    expect(refreshFeatureFlags()).rejects.toThrow('not configured');
  });

  test('refresh stores fetched flags and notifies subscribers', async () => {
    const rpc = mock<() => Promise<RpcResult>>(() =>
      Promise.resolve({ data: allOn, error: null }),
    );
    configureFeatureFlags(makeDb(rpc));
    const listener = mock(() => undefined);
    const unsubscribe = subscribeToFeatureFlags(listener);

    await refreshFeatureFlags();

    expect(getFeatureFlag('GUEST_SIGNUP')).toBe(true);
    expect(getFeatureFlag('DEBUG_LOGGING_SPARK')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await refreshFeatureFlags();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('an earlier refresh resolving late cannot overwrite a newer one', async () => {
    const anonFetch = deferred<RpcResult>();
    const userFetch = deferred<RpcResult>();
    const rpc = mock<() => Promise<RpcResult>>()
      .mockReturnValueOnce(anonFetch.promise)
      .mockReturnValueOnce(userFetch.promise);
    configureFeatureFlags(makeDb(rpc));
    const listener = mock(() => undefined);
    const unsubscribe = subscribeToFeatureFlags(listener);

    const anonRefresh = refreshFeatureFlags();
    const userRefresh = refreshFeatureFlags();

    userFetch.resolve({ data: allOn, error: null });
    await userRefresh;
    anonFetch.resolve({ data: allOff, error: null });
    await anonRefresh;

    expect(getFeatureFlag('GUEST_SIGNUP')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('reset restores defaults, notifies, and discards in-flight refreshes', async () => {
    const loadedFetch = deferred<RpcResult>();
    const staleFetch = deferred<RpcResult>();
    const rpc = mock<() => Promise<RpcResult>>()
      .mockReturnValueOnce(loadedFetch.promise)
      .mockReturnValueOnce(staleFetch.promise);
    configureFeatureFlags(makeDb(rpc));

    const loadedRefresh = refreshFeatureFlags();
    loadedFetch.resolve({ data: allOn, error: null });
    await loadedRefresh;
    expect(getFeatureFlag('GUEST_SIGNUP')).toBe(true);

    const staleRefresh = refreshFeatureFlags();
    const listener = mock(() => undefined);
    const unsubscribe = subscribeToFeatureFlags(listener);
    resetFeatureFlags();
    expect(getFeatureFlag('GUEST_SIGNUP')).toBe(
      FEATURE_FLAG_DEFAULTS.GUEST_SIGNUP,
    );
    expect(listener).toHaveBeenCalledTimes(1);

    // A refresh that was in flight when reset ran must not write back.
    staleFetch.resolve({ data: allOn, error: null });
    await staleRefresh;
    expect(getFeatureFlag('GUEST_SIGNUP')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('refresh retries a failed fetch', async () => {
    const rpc = mock<() => Promise<RpcResult>>()
      .mockResolvedValueOnce({ data: null, error: new Error('rls hiccup') })
      .mockResolvedValueOnce({ data: allOff, error: null });
    configureFeatureFlags(makeDb(rpc));

    await refreshFeatureFlags();

    expect(getFeatureFlag('GUEST_SIGNUP')).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
