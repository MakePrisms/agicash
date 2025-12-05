import { PageContent } from '~/components/page';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { getAccountBalance } from '~/features/accounts/account';
import { useAccount } from '~/features/accounts/account-hooks';
import { BalanceOfflineHoverCard } from '~/features/accounts/balance-offline-hover-card';
import { SettingsViewHeader } from '~/features/settings/ui/settings-view-header';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useSetDefaultAccount } from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';

function AccountDetailItem({
  label,
  value,
}: { label: string; value: React.ReactNode }) {
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

export default function SingleAccount({ accountId }: { accountId: string }) {
  const { toast } = useToast();
  const account = useAccount(accountId);
  const setDefaultAccount = useSetDefaultAccount();
  const balance = getAccountBalance(account);

  const makeDefault = async () => {
    try {
      await setDefaultAccount(account);
    } catch (error) {
      console.error('Failed to make account default', { cause: error });
      toast({
        title: 'Error',
        description: 'Failed to make account default. Please try again',
      });
    }
  };

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
        <div className="flex w-full flex-col gap-12 pt-4">
          <div className="flex flex-col gap-12">
            <h1 className="text-center text-2xl">{account.name}</h1>
            {balance !== null ? (
              <MoneyWithConvertedAmount money={balance} />
            ) : (
              <div className="flex justify-center">
                <BalanceOfflineHoverCard
                  accountType={account.type}
                  className="text-2xl"
                />
              </div>
            )}
          </div>

          <div className="w-full space-y-8 sm:max-w-sm">
            <div className="flex h-[24px] gap-2">
              {account.isDefault && <Badge>Default</Badge>}
              {!account.isOnline && <Badge>Offline</Badge>}
            </div>
            <AccountDetailItem
              label="Type"
              value={<span className="capitalize">{account.type}</span>}
            />
            {account.type === 'cashu' && (
              <AccountDetailItem
                label="Mint"
                value={account.mintUrl
                  .replace('https://', '')
                  .replace('http://', '')}
              />
            )}
          </div>
        </div>

        <div className="fixed right-0 bottom-16 left-0 flex h-[40px] justify-center">
          {!account.isDefault && (
            <Button onClick={makeDefault}>Make default</Button>
          )}
        </div>
      </PageContent>
    </>
  );
}
