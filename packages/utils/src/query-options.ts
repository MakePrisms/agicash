// query-core has no queryOptions() helper; this is the identity helper for type inference.
export const queryOptions = <T>(options: T): T => options;
