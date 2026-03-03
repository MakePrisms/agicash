import { Info } from 'lucide-react';
import {
  ClosePageButton,
  PageHeader,
  PageHeaderItem,
  type PageHeaderPosition,
  PageHeaderTitle,
} from '~/components/page';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '~/components/ui/drawer';
import {
  AccountSelector,
  toAccountSelectorOption,
} from '~/features/accounts/account-selector';
import { accountOfflineToast } from '~/features/accounts/utils';
import { getDefaultUnit } from '~/features/shared/currencies';
import { DomainError } from '~/features/shared/error';
import {
  MoneyInputLayout,
  useMoneyInputField,
} from '~/features/shared/money-input-layout';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import useUserAgent from '~/hooks/use-user-agent';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useAccount, useAccounts } from '../accounts/account-hooks';
import { useReceiveStore } from '../receive/receive-provider';
import { CashAppLogo, buildCashAppDeepLink } from './cash-app';

export default function BuyInput() {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { toast } = useToast();
  const { redirectTo } = useRedirectTo('/');
  const { isMobile } = useUserAgent();

  const buyAccountId = useReceiveStore((s) => s.accountId);
  const buyAccount = useAccount(buyAccountId);
  const buyAmount = useReceiveStore((s) => s.amount);
  const buyCurrencyUnit = getDefaultUnit(buyAccount.currency);
  const setBuyAccount = useReceiveStore((s) => s.setAccount);
  const getReceiveQuote = useReceiveStore((s) => s.getReceiveQuote);
  const status = useReceiveStore((s) => s.status);
  const { data: accounts } = useAccounts();

  const field = useMoneyInputField({
    initialRawInputValue: buyAmount?.toString(buyCurrencyUnit) || '0',
    initialInputCurrency: buyAccount.currency,
    initialOtherCurrency: buyAccount.currency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleContinue = async () => {
    if (!buyAccount.isOnline) {
      toast(accountOfflineToast);
      return;
    }

    let amount: Money;
    if (field.inputValue.currency === buyAccount.currency) {
      amount = field.inputValue;
    } else {
      if (!field.convertedValue) {
        // Can't happen because when there is no converted value, the toggle will not be shown so input currency and buy currency must be the same
        return;
      }
      amount = field.convertedValue;
    }

    const result = await getReceiveQuote(amount);

    if (!result.success) {
      if (result.error instanceof DomainError) {
        toast({ description: result.error.message });
      } else {
        console.error('Failed to create invoice', { cause: result.error });
        toast({
          description: 'Failed to create invoice. Please try again.',
          variant: 'destructive',
        });
      }
      return;
    }

    if (isMobile) {
      window.open(buildCashAppDeepLink(result.quote.paymentRequest), '_blank');
    }

    navigate(buildLinkWithSearchParams('/buy/checkout'), {
      transition: 'slideLeft',
      applyTo: 'newView',
    });
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to={{ pathname: redirectTo, search: '' }}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Buy</PageHeaderTitle>
        <BuyFaqDrawer />
      </PageHeader>

      <MoneyInputLayout
        field={field}
        onContinue={handleContinue}
        continueLoading={status === 'quoting'}
        actions={
          <span className="flex items-center gap-2 whitespace-nowrap text-sm">
            Pay with
            <CashAppLogo className="h-5" />
          </span>
        }
      >
        <div className="w-full max-w-sm sm:max-w-none">
          <AccountSelector
            accounts={accounts.map((account) =>
              toAccountSelectorOption(account),
            )}
            selectedAccount={toAccountSelectorOption(buyAccount)}
            onSelect={(account) => {
              setBuyAccount(account);
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

const faqItems = [
  {
    question: 'Why Cash App?',
    answer:
      'Cash App is the first supported payment method because it natively supports Bitcoin Lightning payments.',
  },
  {
    question: "What if I don't have Cash App?",
    answer:
      "Don't worry, we're launching more payment options soon. In the meantime, you can receive bitcoin from any Bitcoin Lightning wallet by tapping the Receive button.",
  },
  {
    question: "Why isn't my Cash App loading?",
    answer: "Make sure you've downloaded the latest version.",
  },
  {
    question: 'What are the fees?',
    answer:
      'None. Agicash charges zero fees. Cash App charges zero fees. Your transaction executes at the mid-market rate, making this the cheapest way to buy bitcoin.',
  },
  {
    question: 'Is there a purchase limit?',
    answer:
      'Cash App has a $999/week limit on Lightning payments. This is a Cash App limit, not an Agicash limit.',
  },
  {
    question: 'How fast is it?',
    answer:
      'Instant. Your purchase and settlement happen in seconds over the Bitcoin Lightning Network.',
  },
];

function BuyFaqDrawer() {
  return (
    <PageHeaderItem position="right">
      <Drawer>
        <DrawerTrigger asChild>
          <button type="button">
            <Info className="h-5 w-5 text-muted-foreground" />
          </button>
        </DrawerTrigger>
        <DrawerContent className="h-[90svh] font-primary">
          <DrawerHeader className="shrink-0">
            <DrawerTitle>Frequently Asked Questions</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
            <div className="space-y-6">
              {faqItems.map((item) => (
                <div key={item.question}>
                  <h3 className="font-medium text-sm">{item.question}</h3>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </PageHeaderItem>
  );
}
BuyFaqDrawer.isHeaderItem = true;
BuyFaqDrawer.defaultPosition = 'right' as PageHeaderPosition;
