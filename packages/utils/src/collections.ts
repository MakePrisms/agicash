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
