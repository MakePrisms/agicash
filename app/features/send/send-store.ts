import { create } from 'zustand';
import type {
  Account,
  CashuAccount,
  SparkAccount,
} from '~/features/accounts/account';
import type { ClassifiedInput } from '~/features/scan';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { parseCashuPaymentRequest } from '~/lib/cashu';
import { isValidLightningAddress } from '~/lib/lnurl';
import type { Currency, Money } from '~/lib/money';
import { type Contact, isContact } from '../contacts/contact';
import { DomainError } from '../shared/error';
import type { CashuLightningQuote } from './cashu-send-quote-service';
import type { CashuSwapQuote } from './cashu-send-swap-service';
import {
  validateBolt11,
  validateLightningAddressFormat,
} from './destination-validators';
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
  initialDestination?: ClassifiedInput | null;
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

type InitialDestinationState =
  | {
      sendType: 'BOLT11_INVOICE';
      destination: string;
      destinationDisplay: string;
      destinationDetails?: null;
    }
  | {
      sendType: 'LN_ADDRESS';
      destination: null;
      destinationDisplay: string;
      destinationDetails: { lnAddress: string };
    };

/**
 * Turn a pre-validated `ClassifiedInput` from the loader into the initial
 * destination fields of `SendState`. Returns `null` if the classified input
 * is not a valid send destination (cashu-token, unknown).
 */
const classifiedToInitialState = (
  classified: ClassifiedInput,
): InitialDestinationState | null => {
  switch (classified.type) {
    case 'bolt11':
      return {
        sendType: 'BOLT11_INVOICE',
        destination: classified.invoice,
        destinationDisplay: `${classified.invoice.slice(0, 6)}...${classified.invoice.slice(-4)}`,
      };
    case 'ln-address':
      return {
        sendType: 'LN_ADDRESS',
        destination: null,
        destinationDisplay: classified.address,
        destinationDetails: { lnAddress: classified.address },
      };
    case 'cashu-token':
    case 'unknown':
      return null;
  }
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
  const resolvedInitialDestination = initialDestination
    ? classifiedToInitialState(initialDestination)
    : null;

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

    const initialDestinationFields = resolvedInitialDestination ?? {
      sendType: getDefaultSendType(initialAccount.type),
      destination: null,
      destinationDisplay: null,
    };

    return {
      status: 'idle' as const,
      amount: null,
      accountId: initialAccount.id,
      ...initialDestinationFields,
      quote: null,
      cashuToken: null,

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

      selectDestination: async (destination) => {
        if (isContact(destination)) {
          set({
            sendType: 'AGICASH_CONTACT',
            destinationDisplay: destination.username,
            destinationDetails: destination,
          });

          return {
            success: true,
            data: { type: 'AGICASH_CONTACT' },
          };
        }

        const isLnAddressFormat = validateLightningAddressFormat(destination);
        if (isLnAddressFormat === true) {
          const isValidLnAddress = await isValidLightningAddress(destination);
          if (!isValidLnAddress) {
            return {
              success: false,
              error: 'Invalid lightning address',
            };
          }

          set({
            sendType: 'LN_ADDRESS',
            destinationDisplay: destination,
            destinationDetails: { lnAddress: destination },
          });

          return {
            success: true,
            data: { type: 'LN_ADDRESS' },
          };
        }

        const bolt11ParseResult = parseBolt11Invoice(destination);
        if (bolt11ParseResult.valid) {
          const account = get().getSourceAccount();
          const allowZeroAmount = account.type === 'spark';
          const result = validateBolt11(bolt11ParseResult.decoded, {
            allowZeroAmount,
          });
          if (!result.valid) {
            return { success: false, error: result.error };
          }

          set({
            sendType: 'BOLT11_INVOICE',
            destination: bolt11ParseResult.invoice,
            destinationDisplay: `${bolt11ParseResult.invoice.slice(0, 6)}...${bolt11ParseResult.invoice.slice(-4)}`,
          });

          return {
            success: true,
            data: { type: 'BOLT11_INVOICE', amount: result.amount },
          };
        }

        const cashuRequestParseResult = parseCashuPaymentRequest(destination);
        if (cashuRequestParseResult.valid) {
          return {
            success: false,
            error: 'Cashu payment requests are not supported',
          };
        }

        return {
          success: false,
          error:
            'Invalid destination. Must be lightning address, bolt11 invoice or cashu payment request',
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
    };
  });
};

export type SendStore = ReturnType<typeof createSendStore>;
