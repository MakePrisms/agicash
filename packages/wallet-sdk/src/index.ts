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
export * from './auth';
export * from './supabase-session';
export * from './agicash-db';
export * from './performance';
export * from './agicash-mint-auth-provider';
export * from './cashu';
export * from './spark';
export * from './spark-utils';
export * from './user/user';
export * from './user/user-repository';
export * from './user/user-service';
export * from './user/user-cache';
export * from './transactions/transaction';
export * from './transactions/transaction-enums';
export * from './transactions/transaction-repository';
export * from './transactions/transactions-cache';
