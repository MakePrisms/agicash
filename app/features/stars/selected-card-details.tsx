import { Button } from '~/components/ui/button';
import {
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { LinkWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import {
  ANIMATION_DURATION,
  DETAIL_VIEW_DELAY,
  EASE_OUT,
  OPACITY_ANIMATION_RATIO,
} from './animation-constants';

interface SelectedCardDetailsProps {
  account: CashuAccount;
  isVisible: boolean;
}

/**
 * Displays send/receive buttons and transaction history for the selected card.
 * This component shows the interactive elements below the card stack.
 */
export function SelectedCardDetails({
  account,
  isVisible,
}: SelectedCardDetailsProps) {
  const balance = getAccountBalance(account);

  const transitionStyle = `opacity ${ANIMATION_DURATION * OPACITY_ANIMATION_RATIO}ms ${EASE_OUT} ${DETAIL_VIEW_DELAY}ms`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Balance and Actions Section */}
      <div className="flex-shrink-0 px-6 pt-8 md:pt-12">
        <div
          className={cn(
            'flex flex-col items-center gap-6',
            isVisible ? 'opacity-100' : 'opacity-0',
          )}
          style={{ transition: transitionStyle }}
        >
          <MoneyWithConvertedAmount
            money={balance}
            otherCurrency={account.currency === 'BTC' ? 'USD' : 'BTC'}
          />

          {/* Send and Receive Buttons */}
          <div className="grid w-full grid-cols-2 gap-10 pt-3">
            <LinkWithViewTransition
              to={{
                pathname: '/receive',
                search: `accountId=${account.id}`,
              }}
              transition="slideUp"
              applyTo="newView"
            >
              <Button className="w-full py-6 text-lg">Add</Button>
            </LinkWithViewTransition>
            <LinkWithViewTransition
              to={{
                pathname: '/send',
                search: `accountId=${account.id}`,
              }}
              transition="slideUp"
              applyTo="newView"
            >
              <Button className="w-full py-6 text-lg">Send</Button>
            </LinkWithViewTransition>
          </div>
        </div>
      </div>

      {/* Transaction List Section */}
      {/* <div
        className={cn(
          'mx-auto min-h-0 w-full max-w-sm flex-1 overflow-y-auto px-6 pt-2 pb-6',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
        style={{ transition: transitionStyle }}
      >
        <TransactionList accountId={account.id} />
      </div> */}
    </div>
  );
}
