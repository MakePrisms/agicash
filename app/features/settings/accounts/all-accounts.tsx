import { Plus } from 'lucide-react';
import { PageContent } from '~/components/page';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ScrollArea } from '~/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { getAccountBalance } from '~/features/accounts/account';
import { useAccounts } from '~/features/accounts/account-hooks';
import { SettingsViewHeader } from '~/features/settings/ui/settings-view-header';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useUser } from '~/features/user/user-hooks';
import type { Currency } from '~/lib/money';
import { LinkWithViewTransition } from '~/lib/transitions';

function CurrencyAccounts({ currency }: { currency: Currency }) {
  const { data: accounts } = useAccounts({ currency });

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
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
              <MoneyWithConvertedAmount
                money={getAccountBalance(account)}
                variant="inline"
              />
            </div>
            {(account.isDefault || !account.isOnline) && (
              <div className="mt-1 flex gap-2">
                {account.isDefault && <Badge>Default</Badge>}
                {!account.isOnline && <Badge>Offline</Badge>}
              </div>
            )}
          </Card>
        </LinkWithViewTransition>
      ))}
    </div>
  );
}

const tabs = [
  { title: 'Bitcoin', value: 'BTC' },
  { title: 'USD', value: 'USD' },
] as const;

const getTab = (currency: Currency) => {
  return tabs.find((x) => x.value === currency) ?? tabs[0];
};

export default function AllAccounts() {
  const defaultCurrency = useUser((x) => x.defaultCurrency);
  const defaultTab = getTab(defaultCurrency);

  return (
    <>
      <SettingsViewHeader
        title="Accounts"
        navBack={{
          to: '/settings',
          transition: 'slideRight',
          applyTo: 'oldView',
        }}
      />
      <PageContent>
        <Tabs defaultValue={defaultTab.value}>
          <TabsList className="grid w-full grid-cols-2 bg-primary">
            {tabs.map((tab) => (
              <TabsTrigger value={tab.value} key={tab.value}>
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent value={tab.value} key={tab.value} className="mt-8">
              <ScrollArea className="h-[calc(100vh-280px)]">
                <CurrencyAccounts currency={tab.value} />
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
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
