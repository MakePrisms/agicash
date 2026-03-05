import { Outlet } from 'react-router';
import { Page } from '~/components/page';
import { canSendToLightning } from '~/features/accounts/account';
import {
  useDefaultAccount,
  useGetAccount,
} from '~/features/accounts/account-hooks';
import { DomainError } from '~/features/shared/error';
import { TransferProvider } from '~/features/transfer/transfer-provider';
import type { Route } from './+types/_protected.gift-cards_.$cardId.transfer';

export default function GiftCardTransferLayout({
  params,
}: Route.ComponentProps) {
  const getAccount = useGetAccount('cashu');
  const destinationAccount = getAccount(params.cardId);
  const sourceAccount = useDefaultAccount();

  if (!canSendToLightning(sourceAccount)) {
    throw new DomainError(
      'Your default account cannot send Lightning payments. Please change your default account.',
    );
  }

  if (sourceAccount.currency !== destinationAccount.currency) {
    throw new DomainError(
      'Your default account currency does not match the gift card currency.',
    );
  }

  return (
    <Page>
      <TransferProvider
        sourceAccount={sourceAccount}
        destinationAccount={destinationAccount}
      >
        <Outlet />
      </TransferProvider>
    </Page>
  );
}
