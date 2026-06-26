import initBreezWasm from '@agicash/breez-sdk-spark';

let wasmInitPromise: ReturnType<typeof initBreezWasm> | null = null;

/**
 * Thrown when `WebAssembly` is not available in the current browser session.
 * Most commonly caused by iOS Lockdown Mode disabling WASM in WebKit; can also
 * occur in restricted in-app WebViews on Android.
 */
export class WebAssemblyUnavailableError extends Error {
  constructor() {
    super('WebAssembly is not available in this browser session');
    this.name = 'WebAssemblyUnavailableError';
  }
}

/**
 * Initializes the Breez SDK WASM module exactly once, even across concurrent
 * callers. The SDK's own init only short-circuits after completion, so parallel
 * calls mid-init would each run a full fetch/compile/__wbindgen_start. Caching
 * the promise here makes the second caller await the same in-flight init.
 *
 * If `WebAssembly` is not exposed by the runtime, rejects with
 * `WebAssemblyUnavailableError` before invoking any wasm-bindgen code.
 */
export const ensureBreezWasm = () => {
  if (typeof WebAssembly === 'undefined') {
    return Promise.reject(new WebAssemblyUnavailableError());
  }
  wasmInitPromise ??= initBreezWasm();
  return wasmInitPromise;
};
