import { useMutation } from '@tanstack/react-query';
import type { Money } from '~/lib/money';
import type { Account } from '../accounts/account';
import { useUser } from '../user/user-hooks';
import type { TransferQuote } from './transfer-service';
import { useTransferService } from './transfer-service';

export function useGetTransferQuote() {
  const transferService = useTransferService();

  return useMutation({
    mutationFn: ({
      sourceAccount,
      destinationAccount,
      amount,
    }: {
      sourceAccount: Account;
      destinationAccount: Account;
      amount: Money;
    }) => {
      return transferService.getTransferQuote({
        sourceAccount,
        destinationAccount,
        amount,
      });
    },
  });
}

export function useInitiateTransfer() {
  const userId = useUser((user) => user.id);
  const transferService = useTransferService();

  return useMutation({
    mutationFn: ({ quote }: { quote: TransferQuote }) => {
      return transferService.initiateTransfer({ userId, quote });
    },
  });
}
