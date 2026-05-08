import { Plus } from 'lucide-react';
import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { getAccountBalance } from '~/features/accounts/account';
import { useAccounts } from '~/features/accounts/account-hooks';
import { BalanceOfflineHoverCard } from '~/features/accounts/balance-offline-hover-card';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { LinkWithViewTransition } from '~/lib/transitions';

export default function AllAccounts() {
  const { data: accounts } = useAccounts({
    currency: 'BTC',
    purpose: 'transactional',
  });

  return (
    <>
      <PageHeader>
        <PageBackButton
          to="/settings"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Accounts</PageHeaderTitle>
      </PageHeader>
      <PageContent>
        <div className="scrollbar-none h-[calc(100vh-200px)] space-y-3 overflow-y-auto">
          {accounts.map((account) => {
            const balance = getAccountBalance(account);

            return (
              <LinkWithViewTransition
                key={account.id}
                to={`/settings/accounts/${account.id}`}
                transition="slideLeft"
                applyTo="newView"
                className="block"
              >
                <Card className="flex flex-col p-2 px-4 transition-colors hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <h3>{account.name}</h3>
                    {balance !== null ? (
                      <MoneyWithConvertedAmount
                        money={balance}
                        variant="inline"
                      />
                    ) : (
                      <BalanceOfflineHoverCard accountType={account.type} />
                    )}
                  </div>
                  {(account.isDefault || !account.isOnline) && (
                    <div className="mt-1 flex gap-2">
                      {account.isDefault && <Badge>Default</Badge>}
                      {!account.isOnline && <Badge>Offline</Badge>}
                    </div>
                  )}
                </Card>
              </LinkWithViewTransition>
            );
          })}
        </div>
      </PageContent>

      <div className="fixed inset-x-0 bottom-16 flex justify-center">
        <Button asChild size="lg">
          <LinkWithViewTransition
            to="/settings/accounts/create/cashu"
            transition="slideLeft"
            applyTo="newView"
          >
            <Plus size={18} />
            <span>Add Account</span>
          </LinkWithViewTransition>
        </Button>
      </div>
    </>
  );
}
