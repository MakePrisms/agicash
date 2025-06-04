import { AlertCircle, BanknoteIcon, ZapIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Card } from '~/components/ui/card';
import { ScrollArea } from '~/components/ui/scroll-area';
import { LinkWithViewTransition } from '~/lib/transitions';
import { getDefaultUnit } from '../shared/currencies';
import type { Transaction } from './transaction';
import { useTransactions } from './transaction-hooks';

function LoadMore({
  onEndReached,
  isLoading,
}: {
  onEndReached: () => void;
  isLoading?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onEndReached();
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
  }, [onEndReached]);

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
    return 'Reclaimed Send';
  }
  if (transaction.state === 'PENDING') {
    return 'Pending Send';
  }
  return transaction.direction === 'RECEIVE' ? 'Received' : 'Sent';
};

const transactionTypeIcons: Record<Transaction['type'], React.ReactNode> = {
  CASHU_LIGHTNING: <ZapIcon className="h-4 w-4" />,
  CASHU_PAYMENT_REQUEST: <BanknoteIcon className="h-4 w-4" />,
  CASHU_TOKEN: <BanknoteIcon className="h-4 w-4" />,
};
function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <div className="flex w-full items-center justify-start gap-4">
      <LinkWithViewTransition
        to={`/transactions/${transaction.id}`}
        transition="slideUp"
        applyTo="newView"
        className="flex w-full items-center justify-start gap-4"
      >
        {transactionTypeIcons[transaction.type]}
        <div className="flex w-full flex-grow flex-col gap-0">
          <div className="flex items-center justify-between">
            <p className="text-sm">
              {transaction.direction === 'RECEIVE' && '+'}
              {transaction.amount.toLocaleString({
                unit: getDefaultUnit(transaction.amount.currency),
              })}
            </p>
            <span className="text-muted-foreground text-xs">
              {formatRelativeTime(new Date(transaction.createdAt).getTime())}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            {getTransactionDescription(transaction)}
          </p>
        </div>
      </LinkWithViewTransition>
    </div>
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
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useTransactions();

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

  const allTransactions = data.pages.flatMap((page) => page.transactions);

  if (!allTransactions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="text-muted-foreground">No transactions found</span>
      </div>
    );
  }

  const {
    pendingTransactions,
    todayTransactions,
    thisWeekTransactions,
    olderTransactions,
  } = usePartitionTransactions(allTransactions);

  return (
    <ScrollArea className="h-full min-h-0 ">
      <div className="pr-4">
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
            onEndReached={() => !isFetchingNextPage && fetchNextPage()}
            isLoading={isFetchingNextPage}
          />
        )}
      </div>
    </ScrollArea>
  );
}
