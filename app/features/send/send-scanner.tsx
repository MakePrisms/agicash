import {
  ClosePageButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import { useNavigateWithViewTransition } from '~/lib/transitions/view-transition';
import { useSendStore } from './send-provider';

export default function SendScanner() {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const selectDestination = useSendStore((state) => state.selectDestination);
  const setPendingContinue = useSendStore((state) => state.setPendingContinue);

  const handleDecode = (input: string) => {
    const result = selectDestination(input);
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }

    setPendingContinue(true);
    navigate(buildLinkWithSearchParams('/send'), {
      applyTo: 'oldView',
      transition: 'slideDown',
    });
  };

  return (
    <>
      <PageHeader className="z-10">
        <ClosePageButton
          to={buildLinkWithSearchParams('/send')}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Scan</PageHeaderTitle>
      </PageHeader>
      <PageContent className="relative flex items-center justify-center">
        <QRScanner onDecode={handleDecode} />
      </PageContent>
    </>
  );
}
