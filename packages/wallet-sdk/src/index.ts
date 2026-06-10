// Reads expose plain query-options objects (query-core types, no React); the web
// consumes them with stock useSuspenseQuery against the SDK-owned QueryClient.
// A framework-agnostic Query<T> wrapper over the QueryObserver this SDK already
// owns is intentionally deferred to the MCP phase that immediately follows this
// extraction — the MCP wallet is what the extraction is for. Adding it then is
// additive: useSuspenseQuery(x.listOptions()) -> useQ(x.list()).
export * from './query-client';
export * from './encryption';
