import { create } from 'zustand';
import type {
  Account,
  CashuAccount,
  SparkAccount,
} from '~/features/accounts/account';
import type { Currency, Money } from '~/lib/money';
import type { Contact } from '../contacts/contact';
import type { GiftCardInfo } from '../gift-cards/use-discover-cards';
import { DomainError } from '../shared/error';
import type { CashuLightningQuote } from './cashu-send-quote-service';
import type { CashuSwapQuote } from './cashu-send-swap-service';
import { pickSendAccount } from './pick-send-account';
import {
  type SendDestination,
  resolveSendDestination,
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
  /** Initial destination to send to, if any. */
  initialDestination: SendDestination | null;
  getAccount: (accountId: string) => Account;
  getAccounts: () => Account[];
  giftCards: GiftCardInfo[];
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
  getAccounts,
  giftCards,
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

    return {
      status: 'idle' as const,
      accountId: initialAccount.id,
      sendType:
        initialDestination?.sendType ?? getDefaultSendType(initialAccount.type),
      destination: initialDestination?.destination ?? null,
      destinationDisplay: initialDestination?.destinationDisplay ?? null,
      destinationDetails: initialDestination?.destinationDetails ?? null,
      amount:
        initialDestination?.sendType === 'BOLT11_INVOICE'
          ? initialDestination.amount
          : null,
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
        const result = await resolveSendDestination(input, {
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

        const matched =
          result.data.sendType === 'BOLT11_INVOICE'
            ? pickSendAccount({
                decodedBolt11: result.data.decoded,
                accounts: getAccounts(),
                giftCards,
              })
            : null;
        const accountId = matched?.id ?? account.id;

        set({
          accountId,
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
