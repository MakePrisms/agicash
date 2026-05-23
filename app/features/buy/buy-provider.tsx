import {
  type PropsWithChildren,
  createContext,
  useContext,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { useExchangeRate } from '~/hooks/use-exchange-rate';
import type { Account } from '../accounts/account';
import { useGetAccount } from '../accounts/account-hooks';
import { useCreateCashuReceiveQuote } from '../receive/cashu-receive-quote-hooks';
import { useCreateSparkReceiveQuote } from '../receive/spark-receive-quote-hooks';
import type { BuyState, BuyStore } from './buy-store';
import { createBuyStore } from './buy-store';

const BuyContext = createContext<BuyStore | null>(null);

type Props = PropsWithChildren<{
  initialAccount: Account;
}>;

export const BuyProvider = ({ children, initialAccount }: Props) => {
  const getAccount = useGetAccount();
  const { mutateAsync: createCashuReceiveQuote } = useCreateCashuReceiveQuote();
  const { mutateAsync: createSparkReceiveQuote } = useCreateSparkReceiveQuote();
  const { data: exchangeRate } = useExchangeRate('USD-BTC');
  const exchangeRateRef = useRef(exchangeRate);
  exchangeRateRef.current = exchangeRate;

  const [store] = useState(() =>
    createBuyStore({
      initialAccount,
      getAccount,
      getExchangeRate: () => exchangeRateRef.current,
      createCashuReceiveQuote,
      createSparkReceiveQuote,
    }),
  );

  return <BuyContext.Provider value={store}>{children}</BuyContext.Provider>;
};

export const useBuyStore = <T,>(selector: (state: BuyState) => T): T => {
  const store = useContext(BuyContext);
  if (!store) {
    throw new Error('Missing BuyProvider in the tree');
  }
  return useStore(store, selector);
};
