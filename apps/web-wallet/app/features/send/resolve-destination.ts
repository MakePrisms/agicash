import type { Contact } from '@agicash/wallet-sdk/contacts/contact';
import {
  type SendDestination,
  resolveSendDestination as resolveSendDestinationInSdk,
} from '@agicash/wallet-sdk/send/resolve-destination';

export type { SendDestination };

/**
 * Resolves a pasted/typed string or an Agicash contact into a typed
 * {@link SendDestination}.
 *
 * Web-bound wrapper over the SDK resolver: pre-binds the app's dev-localhost
 * allowance (mirrors how `validation.ts` pre-binds the format validator) so the
 * call sites don't repeat the env check.
 */
export const resolveSendDestination = (
  input: string | Contact,
  { allowZeroAmountBolt11 = false }: { allowZeroAmountBolt11?: boolean } = {},
) =>
  resolveSendDestinationInSdk(input, {
    allowZeroAmountBolt11,
    allowLocalhost: import.meta.env.MODE === 'development',
  });
