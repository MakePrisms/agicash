import { X } from 'lucide-react';
import { useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useViewTransitionState,
} from 'react-router';
import {
  Page,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderItem,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import {
  WalletCard,
  WalletCardBackgroundImage,
} from '~/components/wallet-card';
import { useAddCashuAccount } from '~/features/accounts/account-hooks';
import { useToast } from '~/hooks/use-toast';
import type { Currency } from '~/lib/money';
import type { GiftCardInfo } from './use-discover-cards';

type AddGiftCardParams = {
  name: string;
  currency: Currency;
  url: string;
};

function useAddGiftCard() {
  const addCashuAccount = useAddCashuAccount();

  return ({ name, currency, url }: AddGiftCardParams) =>
    addCashuAccount({
      name,
      currency,
      mintUrl: url,
      type: 'cashu',
      purpose: 'gift-card',
    });
}

type AddGiftCardProps = {
  giftCard: GiftCardInfo;
};

/**
 * Add Gift Card component - displays the full size gift card image
 * and an "Add Card" button to add the discover card to the user's wallet.
 */
export function AddGiftCard({ giftCard }: AddGiftCardProps) {
  const [isAdding, setIsAdding] = useState(false);
  const addGiftCard = useAddGiftCard();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isTransitioning = useViewTransitionState('/gift-cards');

  const handleBack = () => {
    navigate('/gift-cards', {
      viewTransition: true,
      state: location.state,
    });
  };

  const handleAddCard = async () => {
    setIsAdding(true);
    try {
      await addGiftCard({
        name: giftCard.name,
        currency: giftCard.currency,
        url: giftCard.url,
      });
      toast({
        title: 'Success',
        description: 'Card added successfully',
        duration: 1500,
      });
      navigate('/gift-cards');
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Unknown error. Failed to add card.';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Page className="relative">
      <PageHeader className="z-10">
        <PageHeaderItem position="left">
          <button type="button" onClick={handleBack} aria-label="Close">
            <X />
          </button>
        </PageHeaderItem>
      </PageHeader>

      <PageContent className="flex flex-col items-center justify-center gap-4">
        <Link
          to="/gift-cards"
          viewTransition
          state={location.state}
          className="flex w-full max-w-sm items-center justify-center"
          style={{
            viewTransitionName: isTransitioning ? 'discover-card' : undefined,
          }}
        >
          <WalletCard className="w-full max-w-none">
            <WalletCardBackgroundImage
              src={giftCard.image}
              alt={giftCard.name}
            />
          </WalletCard>
        </Link>
        {giftCard.addCardDisclaimer && (
          <p className="max-w-sm px-4 text-center text-muted-foreground text-sm">
            {giftCard.addCardDisclaimer}
          </p>
        )}
      </PageContent>

      <PageFooter className="z-10 pb-14">
        <Button
          className="w-[200px]"
          onClick={handleAddCard}
          loading={isAdding}
        >
          Add Card
        </Button>
      </PageFooter>
    </Page>
  );
}
