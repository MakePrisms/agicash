import { z } from 'zod';

/**
 * Converts null values to undefined before passing the value to schema.
 * Use when you need the schema to accept both null and undefined values but you can't use nullish
 * instead of optional because you want to keep the type `T | undefined` instead it being
 * `T | undefined | null`.
 * @param schema - The schema to do the preprocessing for.
 * @returns The schema with preprocessing null to undefined.
 */
export const nullToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess<z.infer<T> | undefined, T, z.infer<T> | null>(
    (v) => (v === null ? undefined : v),
    schema,
  );
