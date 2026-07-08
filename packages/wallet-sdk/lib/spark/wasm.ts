import initBreezWasm from '@agicash/breez-sdk-spark';
import { WebAssemblyUnavailableError } from '../error';

export { WebAssemblyUnavailableError };

let wasmInitPromise: ReturnType<typeof initBreezWasm> | null = null;

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
