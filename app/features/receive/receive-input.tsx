import { getEncodedToken } from '@cashu/cashu-ts';
import { Clipboard, Scan } from 'lucide-react';
import {
  ClosePageButton,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import {
  AccountSelector,
  toAccountSelectorOption,
} from '~/features/accounts/account-selector';
import { accountOfflineToast } from '~/features/accounts/utils';
import { getDefaultUnit } from '~/features/shared/currencies';
import {
  MoneyInputLayout,
  useMoneyInputField,
} from '~/features/shared/money-input-layout';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import { extractCashuToken } from '~/lib/cashu';
import { readClipboard } from '~/lib/read-clipboard';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { useAccount, useAccounts } from '../accounts/account-hooks';
import { useReceiveStore } from './receive-provider';

export default function ReceiveInput() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();
  const { redirectTo } = useRedirectTo('/');
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const receiveAccountId = useReceiveStore((s) => s.accountId);
  const receiveAccount = useAccount(receiveAccountId);
  const receiveAmount = useReceiveStore((s) => s.amount);
  const receiveCurrencyUnit = getDefaultUnit(receiveAccount.currency);
  const setReceiveAccount = useReceiveStore((s) => s.setAccount);
  const setReceiveAmount = useReceiveStore((s) => s.setAmount);
  const { data: accounts } = useAccounts();

  const field = useMoneyInputField({
    initialRawInputValue: receiveAmount?.toString(receiveCurrencyUnit) || '0',
    initialInputCurrency: receiveAccount.currency,
    initialOtherCurrency: receiveAccount.currency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleContinue = async () => {
    if (!receiveAccount.isOnline) {
      toast(accountOfflineToast);
      return;
    }

    if (field.inputValue.currency === receiveAccount.currency) {
      setReceiveAmount(field.inputValue);
    } else {
      if (!field.convertedValue) {
        // Can't happen because when there is no converted value, the toggle will not be shown so input currency and receive currency must be the same
        return;
      }
      setReceiveAmount(field.convertedValue);
    }

    const nextPath =
      receiveAccount.type === 'cashu' ? '/receive/cashu' : '/receive/spark';
    navigate(buildLinkWithSearchParams(nextPath), {
      transition: 'slideLeft',
      applyTo: 'newView',
    });
  };

  const handlePaste = async () => {
    const clipboardContent = await readClipboard();
    if (!clipboardContent) {
      return;
    }

    const token = extractCashuToken(clipboardContent);
    if (!token) {
      toast({
        title: 'Invalid input',
        description: 'Please paste a valid cashu token',
        variant: 'destructive',
      });
      return;
    }

    const encodedToken = getEncodedToken(token);
    const hash = `#${encodedToken}`;

    // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
    // See https://github.com/remix-run/remix/discussions/10721
    window.history.replaceState(null, '', hash);
    navigate(
      {
        ...buildLinkWithSearchParams('/receive/cashu/token', {
          selectedAccountId: receiveAccountId,
        }),
        hash,
      },
      { transition: 'slideLeft', applyTo: 'newView' },
    );
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to={{ pathname: redirectTo, search: '' }}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>

      <MoneyInputLayout
        field={field}
        onContinue={handleContinue}
        actions={
          <>
            <button type="button" onClick={handlePaste}>
              <Clipboard />
            </button>
            <LinkWithViewTransition
              to={buildLinkWithSearchParams('/receive/scan')}
              transition="slideUp"
              applyTo="newView"
            >
              <Scan />
            </LinkWithViewTransition>
          </>
        }
      >
        <div className="w-full max-w-sm sm:max-w-none">
          <AccountSelector
            accounts={accounts.map((account) =>
              toAccountSelectorOption(account),
            )}
            selectedAccount={toAccountSelectorOption(receiveAccount)}
            onSelect={(account) => {
              setReceiveAccount(account);
              if (account.currency !== field.inputValue.currency) {
                field.switchInputCurrency();
              }
            }}
            disabled={accounts.length === 1}
          />
        </div>
      </MoneyInputLayout>
    </>
  );
}
