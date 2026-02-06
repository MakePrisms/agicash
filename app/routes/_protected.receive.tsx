import { Outlet, useSearchParams } from 'react-router';
import { useAccountOrDefault } from '~/features/accounts/account-hooks';
import { ReceiveProvider } from '~/features/receive';
import {
  type ReceiveFlowDefinition,
  ReceiveFlowProvider,
} from '~/features/receive/receive-flow';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useNavigateWithViewTransition } from '~/lib/transitions';

export default function ReceiveLayout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigateWithViewTransition();
  const { redirectTo, buildTo } = useRedirectTo();
  const accountId = searchParams.get('accountId');
  const initialAccount = useAccountOrDefault(accountId);

  const onSuccess = (transactionId: string) => {
    navigate(
      {
        pathname: `/transactions/${transactionId}`,
        search: `redirectTo=${encodeURIComponent(redirectTo)}`,
      },
      { transition: 'slideLeft', applyTo: 'newView' },
    );
  };

  const flow: ReceiveFlowDefinition = {
    amountInput: {
      close: {
        to: { pathname: redirectTo, search: '' },
        transition: 'slideDown',
        applyTo: 'oldView',
      },
      next: {
        cashuLightningInvoice: {
          to: buildTo('/receive/cashu'),
          transition: 'slideLeft',
          applyTo: 'newView',
        },
        sparkLightningInvoice: {
          to: buildTo('/receive/spark'),
          transition: 'slideLeft',
          applyTo: 'newView',
        },
      },
      actions: {
        scanToken: {
          to: buildTo('/receive/scan'),
          transition: 'slideUp',
          applyTo: 'newView',
        },
        claimCashuToken: (selectedAccountId) => ({
          to: buildTo('/receive/cashu/token', { selectedAccountId }),
          transition: 'slideLeft',
          applyTo: 'newView',
        }),
      },
    },
    scanToken: {
      back: {
        to: buildTo('/receive'),
        transition: 'slideDown',
        applyTo: 'oldView',
      },
      next: {
        claimCashuToken: (selectedAccountId) => ({
          to: buildTo('/receive/cashu/token', { selectedAccountId }),
          transition: 'slideLeft',
          applyTo: 'newView',
        }),
      },
    },
    cashuLightningInvoice: {
      back: {
        to: buildTo('/receive'),
        transition: 'slideRight',
        applyTo: 'oldView',
      },
      onSuccess,
    },
    sparkLightningInvoice: {
      back: {
        to: buildTo('/receive'),
        transition: 'slideDown',
        applyTo: 'oldView',
      },
      onSuccess,
    },
    claimCashuToken: {
      back: {
        to: buildTo('/receive'),
        transition: 'slideRight',
        applyTo: 'oldView',
      },
      onSuccess,
    },
  };

  return (
    <ReceiveProvider initialAccount={initialAccount}>
      <ReceiveFlowProvider flow={flow}>
        <Outlet />
      </ReceiveFlowProvider>
    </ReceiveProvider>
  );
}
