// Reads expose plain query-options objects (query-core types, no React); the web
// consumes them with stock useSuspenseQuery against the SDK-owned QueryClient.
// A framework-agnostic Query<T> wrapper over the QueryObserver this SDK already
// owns is intentionally deferred to the MCP phase that immediately follows this
// extraction — the MCP wallet is what the extraction is for. Adding it then is
// additive: useSuspenseQuery(x.listOptions()) -> useQ(x.list()).
export * from './sdk';
export * from './query-client';
export * from './encryption';
export * from './error';
export * from './error-reporting';
export * from './auth';
export * from './supabase-session';
export * from './agicash-db';
export * from './performance';
export * from './agicash-mint-auth-provider';
export * from './cashu';
export * from './spark';
export * from './spark-utils';
export * from './user/user';
export * from './transactions/transaction';
export * from './transactions/transaction-enums';
export * from './contacts/contact';
// Repositories, services, and caches are deliberately NOT exported: they are SDK
// internals reached only through the curated sdk.* surface, so they must not be
// importable (as a value or a type) from outside. The one exception is the
// server lnurl path, which has no sdk instance and imports the user repositories
// as values via the explicit ./user/user-repository subpath.
