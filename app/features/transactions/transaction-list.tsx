import { AlertCircle, BanknoteIcon, UserIcon, ZapIcon } from 'lucide-react';
import {
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { Card } from '~/components/ui/card';
import { ScrollArea } from '~/components/ui/scroll-area';
import { useTransactionAckStatusStore } from '~/features/transactions/transaction-ack-status-store';
import { useIsVisible } from '~/hooks/use-is-visible';
import {
  LinkWithViewTransition,
  VIEW_TRANSITION_DURATION_MS,
} from '~/lib/transitions';
import { useLatest } from '~/lib/use-latest';
import { getDefaultUnit } from '../shared/currencies';
import type { Transaction } from './transaction';
import {
  useAcknowledgeTransaction,
  useTransactions,
} from './transaction-hooks';

function LoadMore({
  onReached,
  isLoading,
}: {
  onReached: () => void;
  isLoading?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onReachedRef = useLatest(onReached);

  // This effect handles the case when viewport is smaller than the content.
  // In that case we want to load the next page when the load more element becomes visible.
  // useLayoutEffect is used because we need access to the DOM ref in effect cleanup which is not possible with useEffect.
  useLayoutEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onReachedRef.current();
        }
      },
      { threshold: 0 },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, []);

  // This useEffect handles the case when viewport is bigger than the content.
  // In that case we want to load as many pages as can fit to the viewport.
  useEffect(() => {
    if (isLoading || !ref.current) {
      return;
    }
    const isVisible =
      ref.current.getBoundingClientRect().bottom <= window.innerHeight;

    if (isVisible) {
      onReachedRef.current();
    }
  }, [isLoading]);

  return (
    <div ref={ref} className="h-4 w-full">
      {isLoading && (
        <div className="flex justify-center p-4">
          <span className="text-muted-foreground text-sm">Loading more...</span>
        </div>
      )}
    </div>
  );
}

/** Format a timestamp to a compact relative time string.
 * Examples:
 * - "now"
 * - "5m"
 * - "2h"
 * - "Jan 15"
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffInSeconds = (now - timestamp) / 1000;

  if (diffInSeconds < 20) {
    return 'now';
  }
  if (diffInSeconds < 60) {
    return `${Math.floor(diffInSeconds)}s`;
  }
  if (diffInSeconds < 3600) {
    return `${Math.floor(diffInSeconds / 60)}m`;
  }
  if (diffInSeconds < 86400) {
    return `${Math.floor(diffInSeconds / 3600)}h`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const getTransactionDescription = (transaction: Transaction) => {
  if (transaction.reversedTransactionId) {
    return 'Received from Reclaim';
  }
  if (transaction.state === 'REVERSED') {
    return transaction.direction === 'RECEIVE'
      ? 'Reclaimed received'
      : 'Reclaimed send';
  }
  if (transaction.state === 'PENDING') {
    return transaction.direction === 'RECEIVE'
      ? 'Pending receive'
      : 'Pending send';
  }
  return transaction.direction === 'RECEIVE' ? 'Received' : 'Sent';
};

const transactionTypeIconMap = {
  CASHU_LIGHTNING: <ZapIcon className="h-4 w-4" />,
  CASHU_TOKEN: <BanknoteIcon className="h-4 w-4" />,
  AGICASH_CONTACT: <UserIcon className="h-4 w-4" />,
};

const getTransactionTypeIcon = (transaction: Transaction) => {
  if (
    transaction.type === 'CASHU_LIGHTNING' &&
    transaction.direction === 'SEND' &&
    transaction.details.destinationDetails?.sendType === 'AGICASH_CONTACT'
  ) {
    return transactionTypeIconMap.AGICASH_CONTACT;
  }
  return transactionTypeIconMap[transaction.type];
};

function TransactionRow({
  transaction,
}: {
  transaction: Transaction;
}) {
  const { mutate: acknowledgeTransaction } = useAcknowledgeTransaction();
  const { setAckStatus, statuses: ackStatuses } =
    useTransactionAckStatusStore();

  const { ref } = useIsVisible({
    threshold: 0.5, // Consider visible when 50% of the element is in view
    onVisibilityChange: useCallback(
      (isVisible: boolean) => {
        if (isVisible && transaction.acknowledgmentStatus === 'pending') {
          acknowledgeTransaction({ transaction });
        }
      },
      [transaction, acknowledgeTransaction],
    ),
  });

  return (
    <LinkWithViewTransition
      to={`/transactions/${transaction.id}`}
      transition="slideUp"
      applyTo="newView"
      className="flex w-full items-center justify-start gap-4"
      ref={ref as Ref<HTMLAnchorElement>}
      onClick={() =>
        setTimeout(() => setAckStatus(transaction), VIEW_TRANSITION_DURATION_MS)
      }
    >
      {getTransactionTypeIcon(transaction)}
      <div className="flex w-full flex-grow flex-col gap-0">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span>
              {transaction.direction === 'RECEIVE' && '+'}
              {transaction.amount.toLocaleString({
                unit: getDefaultUnit(transaction.amount.currency),
              })}
            </span>
            {!transaction.amount.equals(transaction.reservedAmount) &&
              transaction.state === 'PENDING' && (
                <span className="ml-1">
                  (Reserved:{' '}
                  {transaction.reservedAmount.toLocaleString({
                    unit: getDefaultUnit(transaction.reservedAmount.currency),
                  })}
                  )
                </span>
              )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="w-12 text-right">
              <span className="text-muted-foreground text-xs">
                {formatRelativeTime(new Date(transaction.createdAt).getTime())}
              </span>
            </div>
            <div className="flex h-4 w-2 items-center justify-center">
              {ackStatuses.get(transaction.id) === 'pending' && (
                <div className="h-[6px] w-[6px] rounded-full bg-green-500" />
              )}
            </div>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          {getTransactionDescription(transaction)}
        </p>
      </div>
    </LinkWithViewTransition>
  );
}

function TransactionSection({
  title,
  transactions,
}: {
  title: string;
  transactions: Transaction[];
}) {
  if (transactions.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="py-2">
        <span className="font-medium text-lg">{title}</span>
      </div>
      {transactions.map((transaction) => (
        <TransactionRow key={transaction.id} transaction={transaction} />
      ))}
    </div>
  );
}

/** Filter transactions by status and time range */
function usePartitionTransactions(transactions: Transaction[]) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const pendingTransactions: Transaction[] = [];
  const todayTransactions: Transaction[] = [];
  const thisWeekTransactions: Transaction[] = [];
  const olderTransactions: Transaction[] = [];

  // Transactions are already sorted correctly from the database
  // (PENDING first, then by created_at descending)
  for (const transaction of transactions) {
    if (transaction.state === 'PENDING') {
      pendingTransactions.push(transaction);
    } else if (['COMPLETED', 'REVERSED'].includes(transaction.state)) {
      const createdTime = new Date(transaction.createdAt).getTime();
      if (createdTime > oneDayAgo) {
        todayTransactions.push(transaction);
      } else if (createdTime > oneWeekAgo) {
        thisWeekTransactions.push(transaction);
      } else {
        olderTransactions.push(transaction);
      }
    }
  }

  return {
    pendingTransactions,
    todayTransactions,
    thisWeekTransactions,
    olderTransactions,
  };
}

export function TransactionList() {
  const { setIfMissing: setAckStatusIfMissing } =
    useTransactionAckStatusStore();
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useTransactions();

  const allTransactions = useMemo(
    () => data?.pages.flatMap((page) => page.transactions) ?? [],
    [data?.pages],
  );

  useEffect(() => {
    for (const transaction of allTransactions) {
      setAckStatusIfMissing(transaction);
    }
  }, [allTransactions, setAckStatusIfMissing]);

  const {
    pendingTransactions,
    todayTransactions,
    thisWeekTransactions,
    olderTransactions,
  } = usePartitionTransactions(allTransactions);

  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <Card className="max-w-sm p-6">
          <div className="flex flex-col items-center gap-3 text-center text-primary-foreground">
            <AlertCircle className="h-8 w-8" />
            <span>{error?.message || 'Unable to load transactions'}</span>
          </div>
        </Card>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!allTransactions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="text-muted-foreground">No transactions found</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full min-h-0 " hideScrollbar>
      <div className="w-full space-y-6">
        <TransactionSection
          title="Pending"
          transactions={pendingTransactions}
        />
        <TransactionSection title="Today" transactions={todayTransactions} />
        <TransactionSection
          title="This Week"
          transactions={thisWeekTransactions}
        />
        <TransactionSection title="Older" transactions={olderTransactions} />
      </div>
      {hasNextPage && (
        <LoadMore
          onReached={() => !isFetchingNextPage && fetchNextPage()}
          isLoading={isFetchingNextPage}
        />
      )}
    </ScrollArea>
  );
}
