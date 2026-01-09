import { Button } from '~/components/ui/button';
import {
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { TransactionList } from '~/features/transactions/transaction-list';
import { LinkWithViewTransition } from '~/lib/transitions';

import { CARD_WIDTH, CONTENT_TOP } from './card-stack.constants';
import { GiftCardItem } from './gift-card-item';
import { getCardImageByMintUrl } from './use-discover-cards';

type GiftCardDetailProps = {
  account: CashuAccount;
  onCardClick: () => void;
};

/**
 * Detail view for a selected gift card.
 * Shows the card centered at top with balance, actions, and transaction list.
 */
export function GiftCardDetail({ account, onCardClick }: GiftCardDetailProps) {
  const balance = getAccountBalance(account);

  return (
    <div
      className="flex flex-col items-center pb-8"
      style={{ paddingTop: CONTENT_TOP }}
    >
      {/* Selected card - clickable to go back */}
      <button
        type="button"
        onClick={onCardClick}
        aria-label={`Collapse ${account.name} card`}
        style={{
          width: CARD_WIDTH,
          viewTransitionName: 'gift-card',
        }}
      >
        <GiftCardItem
          account={account}
          image={getCardImageByMintUrl(account.mintUrl)}
          className="w-full max-w-none"
          overlayHidden
        />
      </button>

      {/* Balance and actions */}
      <div
        className="mt-4 flex flex-col items-center gap-4"
        style={{ width: CARD_WIDTH }}
      >
        {balance && <MoneyWithConvertedAmount money={balance} size="md" />}

        <div className="grid w-72 grid-cols-2 gap-10">
          <LinkWithViewTransition
            to={`/receive?accountId=${account.id}`}
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full px-7 py-6 text-lg">Add</Button>
          </LinkWithViewTransition>
          <LinkWithViewTransition
            to={`/send?accountId=${account.id}`}
            transition="slideUp"
            applyTo="newView"
          >
            <Button className="w-full px-7 py-6 text-lg">Send</Button>
          </LinkWithViewTransition>
        </div>

        {/* Transaction list */}
        <div className="w-full pb-14">
          <TransactionList
            accountId={account.id}
            className="h-auto overflow-visible"
          />
        </div>
      </div>
    </div>
  );
}
