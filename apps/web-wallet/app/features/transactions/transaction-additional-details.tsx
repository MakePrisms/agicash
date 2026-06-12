import { proofToY } from '@agicash/cashu';
import type { CashuAccount } from '@agicash/wallet-sdk/accounts/account';
import {
  type CashuProof,
  toProof,
} from '@agicash/wallet-sdk/accounts/cashu-account';
import type { Transaction } from '@agicash/wallet-sdk/transactions/transaction';
import { CheckStateEnum, type Proof } from '@cashu/cashu-ts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  Page,
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { useAccountOrNull } from '../accounts/account-hooks';
import { getSdk } from '../shared/sdk';
import { useTransaction } from './transaction-hooks';

const augmentProofsWithState = (
  proofs: CashuProof[] | Proof[],
  states: Map<string, CheckStateEnum>,
) => {
  return proofs.map((p) => ({
    ...p,
    mintState:
      states.get('publicKeyY' in p ? p.publicKeyY : proofToY(p)) ??
      CheckStateEnum.PENDING,
  }));
};

const useProofStates = (
  transactionId: string,
  account: CashuAccount,
  proofs: CashuProof[] | Proof[],
) => {
  const { data: states } = useSuspenseQuery({
    queryKey: ['transaction-proof-states', transactionId],
    queryFn: () =>
      account.wallet.checkProofsStates(
        proofs.map((p) => ('accountId' in p ? toProof(p) : p)),
      ),
    select: (states) => {
      const map = new Map<string, CheckStateEnum>();
      states.forEach((s) => map.set(s.Y, s.state));
      return map;
    },
  });
  return states;
};

function DetailsDisplay({ data }: { data: unknown }) {
  return (
    <div className="space-y-4">
      <pre className="whitespace-pre-wrap break-all text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function LightningSendDetails({
  account,
  transaction,
}: { account: CashuAccount; transaction: Transaction }) {
  const options = getSdk().send.quoteByTransactionIdOptions(transaction.id);

  const { data: sendQuote } = useSuspenseQuery({
    ...options,
    queryFn: async () => {
      const quote = await options.queryFn();
      if (!quote) {
        throw new Error('No send quote found for transaction');
      }
      return quote;
    },
  });

  const states = useProofStates(transaction.id, account, sendQuote.proofs);

  const data = useMemo(() => {
    return {
      ...sendQuote,
      proofs: augmentProofsWithState(sendQuote.proofs, states),
    };
  }, [sendQuote, states]);

  return <DetailsDisplay data={data} />;
}

function LightningReceiveDetails({
  transaction,
}: { transaction: Transaction }) {
  const options = getSdk().receive.quoteByTransactionIdOptions(transaction.id);

  const { data } = useSuspenseQuery({
    ...options,
    queryFn: async () => {
      const quote = await options.queryFn();
      if (!quote) {
        throw new Error('No receive quote found for transaction');
      }
      return quote;
    },
  });

  return <DetailsDisplay data={data} />;
}

function CashuTokenSendDetails({
  account,
  transaction,
}: { account: CashuAccount; transaction: Transaction }) {
  const options = getSdk().send.swapByTransactionIdOptions(transaction.id);

  const { data: swap } = useSuspenseQuery({
    ...options,
    queryFn: async () => {
      const swap = await options.queryFn();
      if (!swap) {
        throw new Error('No send swap found for transaction');
      }
      return swap;
    },
  });

  const allProofs = swap.inputProofs.concat(
    'proofsToSend' in swap ? swap.proofsToSend : [],
  );
  const states = useProofStates(transaction.id, account, allProofs);

  const data = useMemo(() => {
    return {
      ...swap,
      inputProofs: augmentProofsWithState(swap.inputProofs, states),
      ...('proofsToSend' in swap
        ? { proofsToSend: augmentProofsWithState(swap.proofsToSend, states) }
        : {}),
    };
  }, [swap, states]);

  return <DetailsDisplay data={data} />;
}

function CashuTokenReceiveDetails({
  account,
  transaction,
}: { account: CashuAccount; transaction: Transaction }) {
  const options = getSdk().receive.swapByTransactionIdOptions(transaction.id);

  const { data: swap } = useSuspenseQuery({
    ...options,
    queryFn: async () => {
      const swap = await options.queryFn();
      if (!swap) {
        throw new Error('No receive swap found for transaction');
      }
      return swap;
    },
  });

  const states = useProofStates(transaction.id, account, swap.tokenProofs);

  const data = useMemo(() => {
    return {
      ...swap,
      tokenProofs: augmentProofsWithState(swap.tokenProofs, states),
    };
  }, [swap, states]);

  return <DetailsDisplay data={data} />;
}

const getDetails = (transaction: Transaction, account: CashuAccount) => {
  if (
    transaction.type === 'CASHU_LIGHTNING' &&
    transaction.direction === 'SEND'
  ) {
    return <LightningSendDetails account={account} transaction={transaction} />;
  }
  if (transaction.type === 'CASHU_TOKEN' && transaction.direction === 'SEND') {
    return (
      <CashuTokenSendDetails account={account} transaction={transaction} />
    );
  }
  if (
    transaction.type === 'CASHU_LIGHTNING' &&
    transaction.direction === 'RECEIVE'
  ) {
    return <LightningReceiveDetails transaction={transaction} />;
  }
  if (
    transaction.type === 'CASHU_TOKEN' &&
    transaction.direction === 'RECEIVE'
  ) {
    return (
      <CashuTokenReceiveDetails account={account} transaction={transaction} />
    );
  }
  return <div>Unknown transaction type</div>;
};

export function TransactionAdditionalDetails({
  transactionId,
}: { transactionId: string }) {
  const { data: transaction } = useTransaction(transactionId);
  const account = useAccountOrNull(transaction.accountId);

  if (!account) {
    return (
      <Page>
        <PageHeader className="z-10">
          <PageBackButton
            to={`/transactions/${transactionId}`}
            transition="slideRight"
            applyTo="oldView"
          />
          <PageHeaderTitle>Txn Details</PageHeaderTitle>
        </PageHeader>
        <PageContent>
          <div className="text-muted-foreground text-sm">
            Additional details are unavailable because the account has expired.
          </div>
        </PageContent>
      </Page>
    );
  }

  if (account.type !== 'cashu') {
    return <div>Account is not a cashu account</div>;
  }

  const details = getDetails(transaction, account);

  return (
    <Page>
      <PageHeader className="z-10">
        <PageBackButton
          to={`/transactions/${transactionId}`}
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Txn Details</PageHeaderTitle>
      </PageHeader>
      <PageContent className="overflow-hidden">
        <div className="scrollbar-none h-full overflow-y-auto">
          <div className="mb-2 text-xs">type: {transaction.type}</div>
          <div className="mb-2 text-xs">direction: {transaction.direction}</div>
          {details}
        </div>
      </PageContent>
    </Page>
  );
}
