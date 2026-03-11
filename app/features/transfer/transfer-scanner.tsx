import { getEncodedToken } from '@cashu/cashu-ts';
import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import { extractCashuToken } from '~/lib/cashu';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useTransferStore } from './transfer-provider';

export default function TransferScanner() {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const destinationAccountId = useTransferStore((s) => s.destinationAccountId);

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton
          to={buildLinkWithSearchParams(`/transfer/${destinationAccountId}`)}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Scan</PageHeaderTitle>
      </PageHeader>
      <PageContent className="relative flex items-center justify-center">
        <QRScanner
          onDecode={(scannedContent) => {
            const token = extractCashuToken(scannedContent);
            if (!token) {
              toast({
                title: 'Invalid input',
                description: 'Please scan a valid cashu token',
                variant: 'destructive',
              });
              return;
            }

            const encodedToken = getEncodedToken(token);
            const hash = `#${encodedToken}`;

            window.history.replaceState(null, '', hash);
            navigate(
              {
                ...buildLinkWithSearchParams('/receive/cashu/token', {
                  selectedAccountId: destinationAccountId,
                }),
                hash,
              },
              { transition: 'slideLeft', applyTo: 'newView' },
            );
          }}
        />
      </PageContent>
    </>
  );
}
