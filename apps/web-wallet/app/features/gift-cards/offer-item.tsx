import {
  WalletCard,
  WalletCardBackgroundImage,
  WalletCardBlank,
  WalletCardOverlay,
} from '~/components/wallet-card';
import type { CashuAccount } from '~/features/accounts/account';

type OfferItemProps = {
  account: CashuAccount;
  image?: string;
};

export function OfferItem({ account, image }: OfferItemProps) {
  return (
    <WalletCard className="w-full max-w-none">
      {image ? (
        <WalletCardBackgroundImage src={image} alt={account.name} />
      ) : (
        <>
          <WalletCardBlank />
          <WalletCardOverlay className="flex items-center justify-center px-4">
            <span className="truncate text-card-foreground text-lg">
              {account.name}
            </span>
          </WalletCardOverlay>
        </>
      )}
    </WalletCard>
  );
}
