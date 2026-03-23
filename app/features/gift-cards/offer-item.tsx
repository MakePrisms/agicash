import { MoneyDisplay } from '~/components/money-display';
import {
  WalletCard,
  WalletCardBlank,
  WalletCardOverlay,
} from '~/components/wallet-card';
import {
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { getDefaultUnit } from '../shared/currencies';

type OfferItemProps = {
  account: CashuAccount;
};

function formatExpiryDate(expiresAt: number): string {
  const date = new Date(expiresAt * 1000);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function OfferItem({ account }: OfferItemProps) {
  const balance = getAccountBalance(account);

  return (
    <WalletCard className="w-full max-w-none">
      <WalletCardBlank />
      <WalletCardOverlay>
        <div className="flex h-full flex-col justify-between p-5">
          <div className="flex items-center justify-between">
            <span className="text-lg text-white drop-shadow-md">
              {account.name}
            </span>
            {balance && (
              <MoneyDisplay
                money={balance}
                size="sm"
                unit={getDefaultUnit(account.currency)}
                className="text-white drop-shadow-md"
              />
            )}
          </div>
          {account.expiresAt && (
            <p className="text-sm text-white/60">
              Expires {formatExpiryDate(account.expiresAt)}
            </p>
          )}
        </div>
      </WalletCardOverlay>
    </WalletCard>
  );
}
