import { useMutation } from '@tanstack/react-query';
import {
  PageBackButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { useToast } from '~/hooks/use-toast';
import type { Currency } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useAddCashuAccount } from '../accounts/account-hooks';
import { getErrorMessage } from '../shared/error';
import { WalletCard } from '../stars/wallet-card';

type Props = {
  mintUrl: string;
  currency: Currency;
  name: string;
};

/**
 * Component for adding a new mint to the user's wallet.
 * Displays a preview of the mint card for the specified currency.
 */
export default function AddMint({ mintUrl, currency, name }: Props) {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();

  const addCashuAccount = useAddCashuAccount();

  const { mutate: addMintMutation, status: addMintStatus } = useMutation({
    mutationFn: async () => {
      const newAccount = await addCashuAccount({
        name,
        type: 'cashu',
        mintUrl,
        currency,
      });
      return newAccount;
    },
    onSuccess: (account) => {
      navigate(`/cards?accountId=${account.id}`, {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
    onError: (error) => {
      console.error('Error adding mint', { cause: error });
      toast({
        title: 'Failed to add card',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton to="/" transition="slideRight" applyTo="oldView" />
        <PageHeaderTitle>Add Card</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col overflow-hidden">
        <div className="relative mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col overflow-hidden">
          <div className="flex-shrink-0 md:pt-16">
            <WalletCard mintUrl={mintUrl} hideHeader={true} hideFooter={true} />
          </div>
        </div>
      </PageContent>

      <PageFooter className="pb-14">
        <Button
          onClick={() => addMintMutation()}
          className="w-[200px]"
          loading={addMintStatus === 'pending' || addMintStatus === 'success'}
        >
          Add Card
        </Button>
      </PageFooter>
    </>
  );
}
