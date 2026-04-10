import {
  WalletCard,
  WalletCardBackgroundImage,
  WalletCardBlank,
} from '~/components/wallet-card';
import type { CashuAccount } from '~/features/accounts/account';
import { getOfferCardImageByUrl } from './offer-card-images';

type OfferItemProps = {
  account: CashuAccount;
};

export function OfferItem({ account }: OfferItemProps) {
  const image = getOfferCardImageByUrl(account.mintUrl);

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
