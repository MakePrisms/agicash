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
import {
  ANIMATION_DURATION_MS,
  COLLAPSED_OFFSET,
} from './card-stack.constants';

type GiftCardItemProps = {
  account: CashuAccount;
  image?: string;
  size?: WalletCardSize;
  className?: string;
  /** When true, the info overlay (name, balance, gradient) fades out */
  overlayHidden?: boolean;
};

export function GiftCardItem({
  account,
  image,
  size,
  className,
  overlayHidden = false,
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
            height: COLLAPSED_OFFSET + 10,
            background:
              'linear-gradient(to bottom, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.5) 60%, transparent 100%)',
            opacity: overlayHidden ? 0 : 1,
            transition: `opacity ${ANIMATION_DURATION_MS}ms ease-out`,
          }}
        >
          <div
            className="flex items-center justify-between px-5"
            style={{ height: COLLAPSED_OFFSET }}
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
