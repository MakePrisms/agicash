import { getEncodedToken } from '@cashu/cashu-ts';
import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { useToast } from '~/hooks/use-toast';
import { extractCashuToken } from '~/lib/cashu';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useReceiveStore } from './receive-provider';

export default function Scan() {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const receiveAccountId = useReceiveStore((s) => s.accountId);

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton
          to="/receive"
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
            const hash = `#token=${encodedToken}`;

            // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
            // See https://github.com/remix-run/remix/discussions/10721
            window.history.replaceState(null, '', hash);
            navigate(
              `/receive/cashu/token?selectedAccountId=${receiveAccountId}${hash}`,
              {
                transition: 'slideLeft',
                applyTo: 'newView',
              },
            );
          }}
        />
      </PageContent>
    </>
  );
}
