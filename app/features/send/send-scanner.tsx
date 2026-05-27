import {
  ClosePageButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useNavigateWithViewTransition } from '~/lib/transitions';

export default function SendScanner() {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const handleDecode = (scannedContent: string) => {
    if (!scannedContent) return;
    navigate(buildLinkWithSearchParams('/send'), {
      state: { scannedDestination: scannedContent },
      transition: 'slideDown',
      applyTo: 'oldView',
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
