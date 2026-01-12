import { MoneyDisplay } from '~/components/money-display';
import {
  WalletCard,
  WalletCardBackground,
  WalletCardBlank,
  WalletCardOverlay,
  type WalletCardSize,
} from '~/components/wallet-card';
import {
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { getDefaultUnit } from '../shared/currencies';
import { VERTICAL_CARD_OFFSET_IN_STACK } from './card-stack-constants';

type GiftCardItemProps = {
  account: CashuAccount;
  image?: string;
  size?: WalletCardSize;
  className?: string;
  hideOverlayContent?: boolean;
};

export function GiftCardItem({
  account,
  image,
  size,
  className,
  hideOverlayContent,
}: GiftCardItemProps) {
  const balance = getAccountBalance(account);
  const name =
    account.wallet.mintInfo?.name ??
    account.mintUrl.replace('https://', '').replace('http://', '');

  return (
    <WalletCard size={size} className={className}>
      {image ? (
        <WalletCardBackground src={image} alt={name} />
      ) : (
        <WalletCardBlank />
      )}
      <WalletCardOverlay>
        <div
          style={{
            height: VERTICAL_CARD_OFFSET_IN_STACK + 10,
            background:
              'linear-gradient(to bottom, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.5) 60%, transparent 100%)',
          }}
        >
          <div
            className="flex items-center justify-between px-5"
            style={{
              height: VERTICAL_CARD_OFFSET_IN_STACK,
              opacity: hideOverlayContent ? 0 : 1,
              viewTransitionName: `card-overlay-${account.id}`,
            }}
          >
            <span className="text-lg text-white drop-shadow-md">{name}</span>
            {balance && (
              <MoneyDisplay
                money={balance}
                size="sm"
                unit={getDefaultUnit(account.currency)}
                className="text-white drop-shadow-md"
              />
            )}
          </div>
        </div>
      </WalletCardOverlay>
    </WalletCard>
  );
}
