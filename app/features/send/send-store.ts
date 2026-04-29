import { create } from 'zustand';
import type {
  Account,
  CashuAccount,
  SparkAccount,
} from '~/features/accounts/account';
import { parseBolt11Invoice } from '~/lib/bolt11';
import type { Currency, Money } from '~/lib/money';
import type { Contact } from '../contacts/contact';
import { DomainError } from '../shared/error';
import type { CashuLightningQuote } from './cashu-send-quote-service';
import type { CashuSwapQuote } from './cashu-send-swap-service';
import {
  type ResolvedDestination,
  resolveDestination,
} from './resolve-destination';
import type { SparkLightningQuote } from './spark-send-quote-service';

/**
 * Returns the default send type based on account type.
 * - Cashu accounts default to CASHU_TOKEN (no destination required)
 * - Spark accounts default to BOLT11_INVOICE (destination required)
 */
const getDefaultSendType = (
  accountType: Account['type'],
): 'CASHU_TOKEN' | 'BOLT11_INVOICE' => {
  return accountType === 'cashu' ? 'CASHU_TOKEN' : 'BOLT11_INVOICE';
};

const pickAmountByCurrency = <T extends Currency>(
  amounts: Money[],
  currency: T,
): Money<T> => {
  const amount = amounts.find((amount) => amount.currency === currency);
  if (!amount) {
    throw new Error(`Amount in currency (${currency}) was not found`);
  }
  return amount as unknown as Money<T>;
};

type SendType =
  | 'CASHU_TOKEN'
  | 'BOLT11_INVOICE'
  | 'LN_ADDRESS'
  | 'AGICASH_CONTACT';

type DecodedDestination = {
  type: SendType;
  amount?: Money | null;
};

type State = {
  status: 'idle' | 'quoting';
  /**
   * Amount to send.
   */
  amount: Money | null;
  /**
   * ID of the account to send from.
   */
  accountId: string;
  /**
   * Type of the send.
   */
  sendType: SendType;
  /**
   * Stores the actual payment destination value. E.g. bolt11 invoice.
   */
  destination: string | null;
  /**
   * Stores the value that we want to display for the destination.
   * E.g. for agicash contact it's the username, for ln address it's the ln address, etc.
   */
  destinationDisplay: string | null;
} & (
  | {
      sendType: 'CASHU_TOKEN';
      /**
       * Quote to generate a cashu token to send.
       */
      quote: CashuSwapQuote | null;
      destinationDetails?: null;
    }
  | {
      sendType: 'BOLT11_INVOICE';
      /**
       * Quote to make a lightning payment.
       */
      quote: CashuLightningQuote | SparkLightningQuote | null;
      destinationDetails?: null;
    }
  | {
      sendType: 'LN_ADDRESS';
      /**
       * Quote to make a lightning payment.
       */
      quote: CashuLightningQuote | SparkLightningQuote | null;
      /**
       * Stores the additional details about the destination.
       */
      destinationDetails: { lnAddress: string };
    }
  | {
      sendType: 'AGICASH_CONTACT';
      /**
       * Quote to make a lightning payment.
       */
      quote: CashuLightningQuote | SparkLightningQuote | null;
      /**
       * Stores the additional details about the destination.
       */
      destinationDetails: Contact;
    }
);

type ContinueResult =
  | { success: true; next: 'confirmQuote' }
  | { success: true; next: 'selectDestination' }
  | { success: false; error: unknown };

type Actions = {
  selectSourceAccount: (account: Account) => void;
  getSourceAccount: () => Account;
  selectDestination: (
    destination: string | Contact,
  ) => Promise<
    | { success: true; data: DecodedDestination }
    | { success: false; error: string }
  >;
  clearDestination: () => void;
  hasRequiredDestination: () => boolean;
  proceedWithSend: (
    amount: Money<Currency>,
    convertedAmount: Money<Currency> | undefined,
  ) => Promise<ContinueResult>;
};

export type SendState = State & Actions;

type CreateSendStoreProps = {
  initialAccount: Account;
  /**
   * Pre-validated destination produced by the route loader. When present, the
   * store starts with destination/sendType/etc. already populated so that
   * consumers (like `useMoneyInput`) see a complete state on first render.
   */
  initialDestination?: ResolvedDestination | null;
  getAccount: (accountId: string) => Account;
  getInvoiceFromLud16: (params: {
    lud16: string;
    amount: Money<'BTC'>;
  }) => Promise<string>;
  getCashuLightningQuote: (params: {
    account: CashuAccount;
    paymentRequest: string;
    amount: Money<Currency>;
  }) => Promise<CashuLightningQuote>;
  getCashuSwapQuote: (params: {
    account: CashuAccount;
    amount: Money<Currency>;
    senderPaysFee?: boolean;
  }) => Promise<CashuSwapQuote>;
  getSparkLightningQuote: (params: {
    account: SparkAccount;
    paymentRequest: string;
    amount?: Money<Currency>;
  }) => Promise<SparkLightningQuote>;
};

const supportedSendTypes = {
  cashu: ['CASHU_TOKEN', 'BOLT11_INVOICE', 'LN_ADDRESS', 'AGICASH_CONTACT'],
  spark: ['BOLT11_INVOICE', 'LN_ADDRESS', 'AGICASH_CONTACT'],
};

const isSendTypeSupportedForAccount = (
  account: Account,
  sendType: SendType,
) => {
  return supportedSendTypes[account.type].includes(sendType);
};

export const createSendStore = ({
  initialAccount,
  initialDestination,
  getAccount,
  getInvoiceFromLud16,
  getCashuLightningQuote,
  getCashuSwapQuote,
  getSparkLightningQuote,
}: CreateSendStoreProps) => {
  return create<SendState>()((set, get) => {
    const getOrThrow = <T extends keyof SendState>(
      key: T,
      errorMessage?: string,
    ): NonNullable<SendState[T]> => {
      const value = get()[key];
      if (!value) {
        throw new Error(errorMessage ?? `${key} is required`);
      }
      return value;
    };

    const initialDestinationFields = (
      initialDestination
        ? {
            sendType: initialDestination.sendType,
            destination: initialDestination.destination,
            destinationDisplay: initialDestination.destinationDisplay,
            destinationDetails: initialDestination.destinationDetails ?? null,
            amount:
              initialDestination.sendType === 'BOLT11_INVOICE'
                ? (initialDestination.amount ?? null)
                : null,
          }
        : {
            sendType: getDefaultSendType(initialAccount.type),
            destination: null,
            destinationDisplay: null,
            destinationDetails: null,
            amount: null,
          }
    ) as Pick<
      SendState,
      | 'sendType'
      | 'destination'
      | 'destinationDisplay'
      | 'destinationDetails'
      | 'amount'
    >;

    return {
      status: 'idle' as const,
      accountId: initialAccount.id,
      ...initialDestinationFields,
      quote: null,

      selectSourceAccount: (account) => {
        const {
          destination,
          destinationDisplay,
          destinationDetails,
          sendType,
        } = get();
        const hasDestination =
          !!destination || !!destinationDisplay || !!destinationDetails;
        const isSendTypeSupported = isSendTypeSupportedForAccount(
          account,
          sendType,
        );
        const shouldResetSendType = !hasDestination || !isSendTypeSupported;
        set({
          accountId: account.id,
          sendType: shouldResetSendType
            ? getDefaultSendType(account.type)
            : sendType,
          quote: null,
          destination: !shouldResetSendType ? destination : null,
          destinationDisplay: !shouldResetSendType ? destinationDisplay : null,
          destinationDetails: !shouldResetSendType ? destinationDetails : null,
        } as Partial<SendState>);
      },

      getSourceAccount: () => {
        const accountId = get().accountId;
        return getAccount(accountId);
      },

      clearDestination: () => {
        const account = get().getSourceAccount();
        set({
          destination: null,
          destinationDisplay: null,
          destinationDetails: null,
          sendType: getDefaultSendType(account.type),
        } as Partial<SendState>);
      },

      selectDestination: async (input) => {
        const account = get().getSourceAccount();
        const result = await resolveDestination(input, {
          allowZeroAmountBolt11: account.type === 'spark',
        });
        if (!result.success) {
          return result;
        }

        const {
          sendType,
          destination,
          destinationDisplay,
          destinationDetails,
        } = result.data;
        set({
          sendType,
          destination,
          destinationDisplay,
          destinationDetails,
        } as Partial<SendState>);

        return {
          success: true,
          data: {
            type: result.data.sendType,
            amount:
              result.data.sendType === 'BOLT11_INVOICE'
                ? result.data.amount
                : null,
          },
        };
      },

      hasRequiredDestination: () => {
        const { sendType, destination, destinationDetails } = get();
        switch (sendType) {
          case 'CASHU_TOKEN':
            return true;
          case 'BOLT11_INVOICE':
            return !!destination;
          case 'LN_ADDRESS':
            return !!destinationDetails;
          case 'AGICASH_CONTACT':
            return !!destinationDetails;
        }
      },

      proceedWithSend: async (amount, convertedAmount) => {
        const amounts = [amount, convertedAmount].filter((x) => !!x);
        const {
          sendType,
          destination,
          destinationDetails,
          getSourceAccount,
          hasRequiredDestination,
        } = get();
        const account = getSourceAccount();
        const amountToSend = pickAmountByCurrency(amounts, account.currency);

        if (!hasRequiredDestination()) {
          set({ amount: amountToSend });
          return { success: true, next: 'selectDestination' };
        }

        // Cashu lightning quotes need an amount embedded in the bolt11. The
        // runtime `selectDestination` enforces this via `allowZeroAmountBolt11`,
        // but the loader-driven path seeds destinations before an account is
        // locked in, so an amountless invoice can reach this point with a cashu
        // account active. Reject early with a clean DomainError.
        if (
          sendType === 'BOLT11_INVOICE' &&
          account.type === 'cashu' &&
          destination
        ) {
          const parsed = parseBolt11Invoice(destination);
          if (parsed.valid && !parsed.decoded.amountSat) {
            return {
              success: false,
              error: new DomainError(
                'Amount is required for Lightning invoices',
              ),
            };
          }
        }

        set({ status: 'quoting', amount: amountToSend });

        if (sendType === 'CASHU_TOKEN') {
          if (account.type !== 'cashu') {
            throw new Error('Cannot send cashu token from non-cashu account');
          }

          try {
            const quote = await getCashuSwapQuote({
              account: account,
              amount: amountToSend,
            });

            set({ quote });
          } catch (error) {
            console.error(error);
            set({ status: 'idle', quote: null });
            return { success: false, error };
          }
        }

        if (sendType === 'LN_ADDRESS' || sendType === 'AGICASH_CONTACT') {
          const lnAddress =
            sendType === 'LN_ADDRESS'
              ? destinationDetails.lnAddress
              : destinationDetails.lud16;

          const amountInBtc = pickAmountByCurrency(amounts, 'BTC');
          try {
            const bolt11 = await getInvoiceFromLud16({
              lud16: lnAddress,
              amount: amountInBtc,
            });

            set({ destination: bolt11 });
          } catch (error) {
            console.error(error);
            set({ status: 'idle', quote: null });
            return { success: false, error };
          }
        }

        if (
          ['BOLT11_INVOICE', 'LN_ADDRESS', 'AGICASH_CONTACT'].includes(sendType)
        ) {
          const destination = getOrThrow('destination');

          try {
            if (account.type === 'cashu') {
              const quote = await getCashuLightningQuote({
                account,
                paymentRequest: destination,
                amount: amountToSend,
              });
              set({ quote });
            } else if (account.type === 'spark') {
              const quote = await getSparkLightningQuote({
                account,
                paymentRequest: destination,
                amount: amountToSend,
              });
              set({ quote });
            }
          } catch (error) {
            if (!(error instanceof DomainError)) {
              console.error(error);
            }
            set({ status: 'idle', quote: null });
            return { success: false, error };
          }
        }

        set({ status: 'idle' });
        return { success: true, next: 'confirmQuote' };
      },
    } as SendState;
  });
};

export type SendStore = ReturnType<typeof createSendStore>;
