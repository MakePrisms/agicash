import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sum(numbers: number[]) {
  return numbers.reduce((acc, curr) => acc + curr, 0);
}

// isSubset moved to @agicash/utils (shared with the @agicash/cashu subscription
// managers); re-exported here so ~/lib/utils consumers stay unchanged.
export { isSubset } from '@agicash/utils';

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
