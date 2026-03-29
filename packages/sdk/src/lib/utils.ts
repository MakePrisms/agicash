import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sum(numbers: number[]) {
  return numbers.reduce((acc, curr) => acc + curr, 0);
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

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
