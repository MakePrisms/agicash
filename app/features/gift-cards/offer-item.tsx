import {
  WalletCard,
  WalletCardBackgroundImage,
  WalletCardBlank,
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
        <WalletCardBlank />
      )}
    </WalletCard>
  );
}
