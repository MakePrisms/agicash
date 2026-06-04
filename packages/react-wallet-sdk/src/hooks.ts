/**
 * Example domain hooks — illustrate the useQ + useSdk pattern.
 *
 * Each hook calls the relevant domain method (which returns a memoized Query<T>)
 * and bridges it to React via useQ. The domain memos the Query by key, so
 * repeated hook calls in a single render tree share the same observer.
 */
import type { ExtendedAccount } from '@agicash/wallet-sdk';
import { useSdk } from './provider';
import { useQ } from './use-q';

/**
 * Returns the current user's account list (each account carries `isDefault`). Suspends while
 * loading.
 *
 * @example
 * ```tsx
 * function AccountList() {
 *   const accounts = useAccounts();
 *   return <ul>{accounts.map(a => <li key={a.id}>{a.id}</li>)}</ul>;
 * }
 * ```
 */
export function useAccounts(): ExtendedAccount[] {
  // accounts.list() is memoized by the domain (stable Query<T> ref) so this
  // hook is cheap to call from multiple components.
  return useQ(useSdk().accounts.list());
}
