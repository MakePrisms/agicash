import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageFooter,
  PageHeader,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import {
  WalletCard,
  WalletCardBackgroundImage,
} from '~/components/wallet-card';
import { useAddCashuAccount } from '~/features/accounts/account-hooks';
import { useToast } from '~/hooks/use-toast';
import { LinkWithViewTransition } from '~/lib/transitions';
import type { GiftCardInfo } from './use-discover-cards';

type AddGiftCardProps = {
  giftCard: GiftCardInfo;
};

/**
 * Add Gift Card component - displays the full size gift card image
 * and an "Add Card" button to add the discover card to the user's wallet.
 */
export function AddGiftCard({ giftCard }: AddGiftCardProps) {
  const [isAdding, setIsAdding] = useState(false);
  const addAccount = useAddCashuAccount();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleAddCard = async () => {
    setIsAdding(true);
    try {
      await addAccount({
        name: giftCard.name,
        currency: giftCard.currency,
        mintUrl: giftCard.url,
        type: 'cashu',
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
        <ClosePageButton
          to="/gift-cards"
          transition="slideDown"
          applyTo="oldView"
        />
      </PageHeader>

      <PageContent className="flex flex-col items-center justify-center">
        <LinkWithViewTransition
          to="/gift-cards"
          transition="slideDown"
          applyTo="oldView"
          className="flex w-full max-w-sm items-center justify-center"
        >
          <WalletCard className="w-full max-w-none">
            <WalletCardBackgroundImage
              src={giftCard.image}
              alt={giftCard.name}
            />
          </WalletCard>
        </LinkWithViewTransition>
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
