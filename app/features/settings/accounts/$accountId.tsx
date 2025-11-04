import { useCallback } from 'react';
import { PageContent } from '~/components/page';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  type ExtendedAccount,
  type ExtendedCashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { useAccount } from '~/features/accounts/account-hooks';
import { SettingsViewHeader } from '~/features/settings/ui/settings-view-header';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useSetDefaultAccount } from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';

function AccountDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <Badge variant="secondary" className="text-sm">
        {label}
      </Badge>
      <div className="flex items-center">
        <Badge variant="outline" className="text-muted-foreground">
          {value}
        </Badge>
      </div>
    </div>
  );
}

function useMakeDefaultAccount() {
  const { toast } = useToast();
  const setDefaultAccount = useSetDefaultAccount();

  return useCallback(
    async (account: ExtendedAccount) => {
      try {
        await setDefaultAccount(account);
      } catch (error) {
        console.error(error);
        toast({
          title: 'Error',
          description: 'Failed to make account default. Please try again',
        });
      }
    },
    [setDefaultAccount, toast],
  );
}

function CashuAccount({ account }: { account: ExtendedCashuAccount }) {
  const makeDefault = useMakeDefaultAccount();

  return (
    <>
      <div className="flex w-full flex-col gap-12 pt-4">
        <div className="flex flex-col gap-12">
          <h1 className="text-center text-2xl">{account.name}</h1>
          <MoneyWithConvertedAmount money={getAccountBalance(account)} />
        </div>

        <div className="w-full space-y-8 sm:max-w-sm">
          <div className="flex h-[24px] gap-2">
            {account.isDefault && <Badge>Default</Badge>}

            {!account.isOnline && <Badge>Offline</Badge>}
          </div>
          {[
            {
              label: 'Type',
              value: account.type[0].toUpperCase() + account.type.slice(1),
            },
            {
              label: 'Mint',
              value: account.mintUrl
                .replace('https://', '')
                .replace('http://', ''),
            },
          ].map((detail) => (
            <AccountDetailItem key={detail.label} {...detail} />
          ))}
        </div>
      </div>

      <div className="fixed right-0 bottom-16 left-0 flex h-[40px] justify-center">
        {!account.isDefault && (
          <Button onClick={() => makeDefault(account)}>Make default</Button>
        )}
      </div>
    </>
  );
}

function SparkAccount({ account }: { account: ExtendedAccount<'spark'> }) {
  const makeDefault = useMakeDefaultAccount();

  return (
    <>
      <div className="flex w-full flex-col gap-12 pt-4">
        <div className="flex flex-col gap-12">
          <h1 className="text-center text-2xl">{account.name}</h1>
          <MoneyWithConvertedAmount money={getAccountBalance(account)} />
        </div>

        <div className="w-full space-y-8 sm:max-w-sm">
          <div className="flex h-[24px] gap-2">
            {account.isDefault && <Badge>Default</Badge>}
            {account.isOnline && <Badge variant="secondary">Online</Badge>}
          </div>
          {[
            {
              label: 'Type',
              value: account.type[0].toUpperCase() + account.type.slice(1),
            },
          ].map((detail) => (
            <AccountDetailItem key={detail.label} {...detail} />
          ))}
        </div>
      </div>

      <div className="fixed right-0 bottom-16 left-0 flex h-[40px] justify-center">
        {!account.isDefault && (
          <Button onClick={() => makeDefault(account)}>Make default</Button>
        )}
      </div>
    </>
  );
}

export default function SingleAccount({ accountId }: { accountId: string }) {
  const account = useAccount(accountId);
  return (
    <>
      <SettingsViewHeader
        navBack={{
          to: '/settings/accounts',
          transition: 'slideRight',
          applyTo: 'oldView',
        }}
      />
      <PageContent>
        {account.type === 'cashu' && <CashuAccount account={account} />}
        {account.type === 'spark' && <SparkAccount account={account} />}
      </PageContent>
    </>
  );
}
