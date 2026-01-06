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
import { WalletCard, WalletCardBackground } from '~/components/wallet-card';
import { useAddCashuAccount } from '~/features/accounts/account-hooks';
import { NotFoundError } from '~/features/shared/error';
import { useToast } from '~/hooks/use-toast';
import type { Currency } from '~/lib/money/types';
import { LinkWithViewTransition } from '~/lib/transitions';
import { DISCOVER_MINTS } from './use-discover-cards';

type AddGiftCardProps = {
  mintUrl: string;
  currency: Currency;
};

/**
 * Add Gift Card component - displays the full size gift card image
 * and an "Add Card" button to add the discover card to the user's wallet.
 */
export function AddGiftCard({ mintUrl, currency }: AddGiftCardProps) {
  const [isAdding, setIsAdding] = useState(false);
  const addAccount = useAddCashuAccount();
  const navigate = useNavigate();
  const { toast } = useToast();

  const mint = DISCOVER_MINTS.find(
    (m) => m.url === mintUrl && m.currency === currency,
  );

  if (!mint) {
    throw new NotFoundError('Card not found');
  }

  const handleAddCard = async () => {
    setIsAdding(true);
    try {
      await addAccount({
        name: mint.name,
        currency: mint.currency,
        mintUrl: mint.url,
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

      <PageContent className="">
        <LinkWithViewTransition
          to="/gift-cards"
          transition="slideDown"
          applyTo="oldView"
          className="absolute inset-0 mx-auto flex max-w-sm items-center justify-center px-4"
        >
          <WalletCard className="w-full max-w-none">
            <WalletCardBackground src={mint.image} alt={mint.name} />
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
