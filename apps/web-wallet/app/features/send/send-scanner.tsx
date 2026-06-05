import {
  ClosePageButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useNavigateWithViewTransition } from '~/lib/transitions/view-transition';

export default function SendScanner() {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  const handleDecode = (scannedContent: string) => {
    if (!scannedContent) return;

    const hash = `#${scannedContent}`;
    // The hash needs to be set manually before navigating or the destination
    // route's clientLoader won't see it.
    // See https://github.com/remix-run/remix/discussions/10721
    window.history.replaceState(null, '', hash);
    navigate(
      { ...buildLinkWithSearchParams('/send'), hash },
      { transition: 'slideDown', applyTo: 'oldView' },
    );
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
