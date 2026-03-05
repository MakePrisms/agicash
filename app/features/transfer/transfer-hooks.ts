import { useMutation } from '@tanstack/react-query';
import type { Money } from '~/lib/money';
import type { Account } from '../accounts/account';
import { ConcurrencyError, DomainError } from '../shared/error';
import { useUser } from '../user/user-hooks';
import type { TransferQuote } from './transfer-service';
import { useTransferService } from './transfer-service';

export function useCreateTransferQuote() {
  const transferService = useTransferService();

  return useMutation({
    scope: { id: 'create-transfer-quote' },
    mutationFn: ({
      sourceAccount,
      destinationAccount,
      amount,
    }: {
      sourceAccount: Account;
      destinationAccount: Account;
      amount: Money;
    }) =>
      transferService.getTransferQuote({
        sourceAccount,
        destinationAccount,
        amount,
      }),
    retry: (failureCount, error) => {
      if (error instanceof DomainError) return false;
      return failureCount < 1;
    },
  });
}

export function useInitiateTransfer({
  onSuccess,
  onError,
}: {
  onSuccess: (data: {
    sendTransactionId: string;
    receiveTransactionId: string;
  }) => void;
  onError: (error: Error) => void;
}) {
  const userId = useUser((user) => user.id);
  const transferService = useTransferService();

  return useMutation({
    scope: { id: 'initiate-transfer' },
    mutationFn: ({
      sourceAccount,
      destinationAccount,
      transferQuote,
    }: {
      sourceAccount: Account;
      destinationAccount: Account;
      transferQuote: TransferQuote;
    }) =>
      transferService.initiateTransfer({
        userId,
        sourceAccount,
        destinationAccount,
        transferQuote,
      }),
    onSuccess: (data) => {
      onSuccess({
        sendTransactionId: data.sendTransactionId,
        receiveTransactionId: data.receiveTransactionId,
      });
    },
    onError,
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) return true;
      if (error instanceof DomainError) return false;
      return failureCount < 1;
    },
  });
}
