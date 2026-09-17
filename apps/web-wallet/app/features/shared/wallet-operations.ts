import {
  type DataStrategyResult,
  type MiddlewareFunction,
  redirect,
} from 'react-router';
import { toast } from '~/hooks/use-toast';
import { DomainError } from './error';
import { featureFlagsQueryOptions, getFeatureFlag } from './feature-flags';
import { getQueryClient } from './query-client';

export const SIGNUP_DISABLED_MESSAGE =
  'Agicash is shutting down and no longer accepts new signups.';

export const SEND_RECEIVE_DISABLED_MESSAGE =
  'Agicash is shutting down. Sending and receiving are no longer available.';

export const TOKEN_CLAIM_DISABLED_MESSAGE =
  'Agicash is shutting down and no longer accepts new signups, so this token cannot be claimed here.';

/**
 * Guards the signup actions. Throws a {@link DomainError} while the WALLET_OPERATIONS flag is off.
 */
export function assertSignupEnabled(): void {
  if (!getFeatureFlag('WALLET_OPERATIONS')) {
    throw new DomainError(SIGNUP_DISABLED_MESSAGE);
  }
}

/**
 * Client middleware for the send and receive route trees. Sends the user back to the wallet home
 * with a toast while the WALLET_OPERATIONS flag is off.
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
      description: SEND_RECEIVE_DISABLED_MESSAGE,
    });
    throw redirect('/');
  }
  await next();
};
