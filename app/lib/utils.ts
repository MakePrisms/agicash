import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ZodType, ZodTypeDef } from 'zod';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sum(numbers: number[]) {
  return numbers.reduce((acc, curr) => acc + curr, 0);
}

export function hexToUint8Array(hex: string) {
  return new Uint8Array(
    hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

export function uint8ArrayToHex(uint8Array: Uint8Array) {
  return Array.from(uint8Array)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
  const isSubsetOf = (
    subset as unknown as {
      isSubsetOf?: (other: ReadonlySet<T>) => boolean;
    }
  ).isSubsetOf;

  if (typeof isSubsetOf === 'function') {
    return isSubsetOf.call(subset, superset);
  }

  for (const item of subset) {
    if (!superset.has(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Parses hash parameters from a URL hash string and validates/transforms them using a zod schema
 * @param hash - The hash string (e.g., "#key=value&other=param")
 * @param schema - Zod schema for validation and transformation
 * @returns Parsed and transformed object or null if parsing/validation fails
 */
export function parseHashParams<T, Input = Record<string, string>>(
  hash: string,
  schema: ZodType<T, ZodTypeDef, Input>,
): T | null {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;

  if (!cleanHash) {
    return null;
  }

  const params: Record<string, string> = {};
  const urlParams = new URLSearchParams(cleanHash);

  for (const [key, value] of urlParams.entries()) {
    params[key] = value;
  }

  const result = schema.safeParse(params);

  if (result.success) {
    return result.data;
  }

  console.error('Invalid hash params', { hash, error: result.error });

  return null;
}
