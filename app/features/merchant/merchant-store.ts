import { create } from 'zustand';
import type { Account } from '~/features/accounts/account';
import type { Money } from '~/lib/money';
import type { AccountsCache } from '../accounts/account-hooks';
import type { CashuSwapQuote } from '../send/cashu-send-swap-service';

export const CARD_CODE_LENGTH = 4;

type State = {
  /**
   * Amount to send.
   */
  amount: Money | null;
  /**
   * The code printed on the card that will be required to fetch the token from the database
   */
  cardCode: string;
  /**
   * ID of the account to send from.
   */
  accountId: string;
  /**
   * Quote for the swap (includes fees and validation)
   */
  quote: CashuSwapQuote | null;
  /**
   * Status of quote fetching
   */
  status: 'idle' | 'quoting';
  /**
   * Private key for the created token (P2PK spending condition)
   */
  privateKey: string | null;
};

type Actions = {
  setAmount: (amount: Money) => void;
  setCode: (code: string) => void;
  handleCodeInput: (input: string, onInvalidInput?: () => void) => void;
  setQuote: (quote: CashuSwapQuote | null) => void;
  setStatus: (status: 'idle' | 'quoting') => void;
  setPrivateKey: (privateKey: string) => void;
  setAccount: (account: Account) => void;
  getSourceAccount: () => Account;
  getQuote: (
    amount: Money,
    requireSwap: boolean,
  ) => Promise<{ success: true } | { success: false; error: unknown }>;
  reset: () => void;
};

export type MerchantState = State & Actions;

type CreateMerchantStoreProps = {
  initialAccount: Account;
  accountsCache: AccountsCache;
  getLatestAccount: (accountId: string) => Promise<Account>;
  getCashuSendSwapQuote: (params: {
    accountId: string;
    amount: Money;
    requireSwap: boolean;
    senderPaysFee?: boolean;
  }) => Promise<CashuSwapQuote>;
};

export const createMerchantStore = ({
  initialAccount,
  accountsCache,
  getLatestAccount,
  getCashuSendSwapQuote,
}: CreateMerchantStoreProps) => {
  return create<MerchantState>()((set, get) => ({
    amount: null,
    cardCode: '',
    accountId: initialAccount.id,
    quote: null,
    status: 'idle',
    privateKey: null,

    setAmount: (amount) => set({ amount }),

    setCode: (code) => {
      if (code.length > CARD_CODE_LENGTH) {
        throw new Error(`Code must be less than ${CARD_CODE_LENGTH} digits`);
      }
      if (!Number.isInteger(Number(code))) {
        throw new Error('Code must be an integer');
      }
      set({ cardCode: code });
    },

    handleCodeInput: (input, onInvalidInput) => {
      const currentCardCode = get().cardCode;

      if (input === 'Backspace') {
        if (currentCardCode.length === 0) {
          onInvalidInput?.();
          return;
        }
        const newCardCode = currentCardCode.slice(0, -1);
        set({ cardCode: newCardCode });
        return;
      }

      if (currentCardCode.length >= CARD_CODE_LENGTH) {
        onInvalidInput?.();
        return;
      }

      if (!Number.isInteger(Number(input))) {
        onInvalidInput?.();
        return;
      }

      const newCardCode = currentCardCode + input;
      set({ cardCode: newCardCode });
    },

    setQuote: (quote) => set({ quote }),

    setStatus: (status) => set({ status }),

    setPrivateKey: (privateKey) => set({ privateKey }),

    setAccount: (account) => set({ accountId: account.id }),

    getSourceAccount: () => {
      const accountId = get().accountId;
      const account = accountsCache.get(accountId);
      if (!account) {
        throw new Error(`Account with id ${accountId} not found`);
      }
      return account;
    },

    getQuote: async (amount, requireSwap) => {
      const { accountId } = get();
      const account = await getLatestAccount(accountId);

      if (account.type !== 'cashu') {
        return {
          success: false,
          error: new Error('Only cashu accounts supported'),
        };
      }

      set({ status: 'quoting', amount });

      try {
        const quote = await getCashuSendSwapQuote({
          accountId: account.id,
          amount,
          requireSwap,
          senderPaysFee: true,
        });

        set({ quote, status: 'idle' });
        return { success: true };
      } catch (error) {
        console.error('Error getting merchant quote:', {
          cause: error,
          amount,
          accountId,
        });
        set({ status: 'idle' });
        return { success: false, error };
      }
    },

    reset: () =>
      set({
        amount: null,
        cardCode: '',
        accountId: initialAccount.id,
        quote: null,
        status: 'idle',
        privateKey: null,
      }),
  }));
};

export type MerchantStore = ReturnType<typeof createMerchantStore>;
