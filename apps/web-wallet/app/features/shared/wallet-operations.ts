import {
  type DataStrategyResult,
  type MiddlewareFunction,
  redirect,
} from 'react-router';
import { toast } from '~/hooks/use-toast';
import { DomainError } from './error';
import { featureFlagsQueryOptions } from './feature-flags';
import { getQueryClient } from './query-client';

export const SIGNUP_DISABLED_MESSAGE =
  'Agicash is shutting down and no longer accepts new signups.';

export const WALLET_OPERATIONS_DISABLED_MESSAGE =
  'Agicash is shutting down. Sending, receiving and buying are no longer available.';

export const TOKEN_CLAIM_DISABLED_MESSAGE =
  'Agicash is shutting down. Tokens can no longer be claimed here.';

/**
 * Guards the signup actions. Always throws a {@link DomainError}: signups are closed for good.
 *
 * Deliberately independent of the WALLET_OPERATIONS flag, which is re-enabled per user after the
 * sunset so existing users can withdraw their funds. That must never re-open signups.
 */
export function assertSignupEnabled(): void {
  throw new DomainError(SIGNUP_DISABLED_MESSAGE);
}

/**
 * Client middleware for the send, receive and buy route trees. Sends the user back to the wallet
 * home with a toast while the WALLET_OPERATIONS flag is off.
 */
export const requireWalletOperations: MiddlewareFunction<
  Record<string, DataStrategyResult>
> = async (_, next) => {
  const flags = await getQueryClient().ensureQueryData(
    featureFlagsQueryOptions,
  );
  if (!flags.WALLET_OPERATIONS) {
    toast({
      title: 'Not available',
      description: WALLET_OPERATIONS_DISABLED_MESSAGE,
    });
    throw redirect('/');
  }
  await next();
};
