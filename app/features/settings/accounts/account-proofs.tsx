import { CheckStateEnum } from '@cashu/cashu-ts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageBackButton, PageContent, PageHeader } from '~/components/page';
import { Button } from '~/components/ui/button';
import { ScrollArea } from '~/components/ui/scroll-area';
import type { CashuAccount } from '~/features/accounts/account';
import { useAccount } from '~/features/accounts/account-hooks';
import type { CashuProof } from '~/features/accounts/cashu-account';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { getCashuUnit, sumProofs } from '~/lib/cashu';
import { Money } from '~/lib/money';
import type { Currency } from '~/lib/money';

function ProofRow({
  proof,
  currency,
  showRemove,
}: {
  proof: CashuProof;
  currency: Currency;
  showRemove?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const money = new Money({
    amount: proof.amount,
    currency,
    unit: getCashuUnit(currency),
  });

  return (
    <div className="flex w-full flex-col">
      <div
        className={`grid w-full items-center gap-2 ${showRemove ? 'grid-cols-[8rem_1fr_auto]' : 'grid-cols-[8rem_1fr]'}`}
      >
        <button
          type="button"
          className="col-span-2 grid cursor-pointer grid-cols-[8rem_1fr] items-center gap-2 overflow-hidden text-left"
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="block w-32">
            <MoneyWithConvertedAmount money={money} variant="inline" />
          </span>
          <code className="min-w-0 truncate whitespace-nowrap text-xs">
            {proof.secret}
          </code>
        </button>
        {showRemove && (
          <Button
            variant="outline"
            size="icon"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {expanded && (
          <pre className="col-span-full mt-1 break-all text-xs">
            {JSON.stringify(proof, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function ProofSection({
  title,
  proofs,
  currency,
  showRemove,
}: {
  title: string;
  proofs: CashuProof[];
  currency: Currency;
  showRemove?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-lg">
        {title} ({proofs.length})
      </h2>
      {proofs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No proofs</p>
      ) : (
        <div className="space-y-2">
          {proofs.map((p) => (
            <ProofRow
              key={p.secret}
              proof={p}
              currency={currency}
              showRemove={showRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function useProofs(account: CashuAccount) {
  const { data: states } = useSuspenseQuery({
    queryKey: ['account-proof-states', account.id, account.version],
    queryFn: () =>
      account.wallet.checkProofsStates(
        account.proofs.map((x) => ({
          id: x.keysetId,
          amount: x.amount,
          secret: x.secret,
          C: x.unblindedSignature,
          dleq: x.dleq,
          witness: x.witness,
        })),
      ),
  });

  return useMemo(() => {
    const unspent: CashuProof[] = [];
    const spent: CashuProof[] = [];
    const pending: CashuProof[] = [];

    for (const proof of account.proofs) {
      const state =
        states.find((s) => s.Y === proof.publicKeyY)?.state ??
        CheckStateEnum.PENDING;
      if (state === CheckStateEnum.UNSPENT) {
        unspent.push(proof);
      } else if (state === CheckStateEnum.SPENT) {
        spent.push(proof);
      } else {
        pending.push(proof);
      }
    }

    return {
      unspentProofs: unspent,
      spentProofs: spent,
      pendingProofs: pending,
    };
  }, [account.proofs, states]);
}

export default function AccountProofs({ accountId }: { accountId: string }) {
  const account = useAccount(accountId);

  if (account.type !== 'cashu') {
    throw new Error('Account must be a cashu account');
  }

  const { unspentProofs, spentProofs, pendingProofs } = useProofs(account);

  const getMoney = (proofs: CashuProof[]) =>
    new Money({
      amount: sumProofs(proofs),
      currency: account.currency,
      unit: getCashuUnit(account.currency),
    });

  const totalMoney = getMoney(account.proofs);
  const unspentMoney = getMoney(unspentProofs);
  const pendingMoney = getMoney(pendingProofs);
  const spentMoney = getMoney(spentProofs);

  return (
    <>
      <PageHeader>
        <PageBackButton
          to={`/settings/accounts/${accountId}`}
          transition="slideRight"
          applyTo="oldView"
        />
      </PageHeader>
      <PageContent className="overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-8">
            <div className="space-y-2">
              <h1 className="text-center text-2xl">{account.name} - Proofs</h1>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Total</span>
                  <MoneyWithConvertedAmount
                    money={totalMoney}
                    variant="inline"
                  />
                </div>
                <div className="flex justify-between">
                  <span>Unspent</span>
                  <MoneyWithConvertedAmount
                    money={unspentMoney}
                    variant="inline"
                  />
                </div>
                <div className="flex justify-between">
                  <span>Pending</span>
                  <MoneyWithConvertedAmount
                    money={pendingMoney}
                    variant="inline"
                  />
                </div>
                <div className="flex justify-between">
                  <span>Spent</span>
                  <MoneyWithConvertedAmount
                    money={spentMoney}
                    variant="inline"
                  />
                </div>
              </div>
            </div>

            <ProofSection
              title="Unspent proofs"
              proofs={unspentProofs}
              currency={account.currency}
            />
            <ProofSection
              title="Pending proofs"
              proofs={pendingProofs}
              currency={account.currency}
            />
            <ProofSection
              title="Spent proofs"
              proofs={spentProofs}
              currency={account.currency}
              showRemove
            />
          </div>
        </ScrollArea>
      </PageContent>
    </>
  );
}
