/**
 * True when every element of `subset` is in `superset`. Uses the native
 * `Set.prototype.isSubsetOf` when the runtime provides it, else a manual scan.
 */
export function isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
  const native = (subset as { isSubsetOf?: (other: Set<T>) => boolean })
    .isSubsetOf;
  if (typeof native === 'function') {
    return native.call(subset, superset);
  }
  for (const item of subset) {
    if (!superset.has(item)) return false;
  }
  return true;
}
