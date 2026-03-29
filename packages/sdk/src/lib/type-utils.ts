import type { KeysOfUnion, SharedUnionFields, Simplify } from 'type-fest';

/**
 * Like AllUnionFields, but non-common fields are required with `| undefined | null`
 * instead of optional. Forces explicit acknowledgment of all fields.
 */
export type AllUnionFieldsRequired<Union> = Simplify<
  // Common fields: required, original type
  SharedUnionFields<Union> & {
    // Non-common fields: required, but value can be undefined or null
    [K in Exclude<KeysOfUnion<Union>, keyof Union>]-?:
      | (Union extends Record<K, infer V> ? V : never)
      | undefined
      | null;
  }
>;
