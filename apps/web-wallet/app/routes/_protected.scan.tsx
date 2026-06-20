import { classifyInput } from '@agicash/wallet-sdk/scan';
import { validateBolt11 } from '@agicash/wallet-sdk/send/validation';
import { Clipboard } from 'lucide-react';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { Button } from '~/components/ui/button';
import useIsPwa from '~/hooks/use-is-pwa';
import { useToast } from '~/hooks/use-toast';
import { readClipboard } from '~/lib/read-clipboard';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';

export default function ScanPage() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();
  const isPwa = useIsPwa();

  const handleInput = (raw: string) => {
    const result = classifyInput(raw, { allowLocalhost: import.meta.env.DEV });

    if (!result) {
      toast({
        title: 'Invalid QR code',
        description:
          'Please scan a cashu token, lightning invoice, or lightning address',
        variant: 'destructive',
      });
      return;
    }

    if (result.direction === 'receive') {
      const hash = `#${result.encoded}`;
      // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
      // See https://github.com/remix-run/remix/discussions/10721
      window.history.replaceState(null, '', hash);
      navigate(
        { pathname: '/receive/cashu/token', hash },
        { transition: 'slideLeft', applyTo: 'newView' },
      );
      return;
    }

    if (result.type === 'bolt11') {
      const validation = validateBolt11(result.decoded, {
        allowZeroAmount: true,
      });
      if (!validation.valid) {
        toast({
          title: 'Invalid invoice',
          description: validation.error,
          variant: 'destructive',
        });
        return;
      }
    }

    const hash = `#${result.type === 'bolt11' ? result.invoice : result.address}`;
    // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
    // See https://github.com/remix-run/remix/discussions/10721
    window.history.replaceState(null, '', hash);
    navigate(
      { pathname: '/send', hash },
      { transition: 'slideLeft', applyTo: 'newView' },
    );
  };

  const handlePaste = async () => {
    const text = await readClipboard();
    if (text) handleInput(text);
  };

  return (
    <Page>
      <PageHeader className="z-20">
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Scan</PageHeaderTitle>
      </PageHeader>
      <PageContent className="relative z-10 mx-auto items-center pt-20 sm:justify-center sm:py-0">
        <QRScanner onDecode={handleInput} />
        <div
          className={cn(
            'sm:-translate-x-1/2 mt-auto flex w-72 flex-col items-center gap-4 sm:absolute sm:bottom-14 sm:left-1/2 sm:mt-0',
            isPwa && 'pb-20',
          )}
        >
          <Button type="button" onClick={handlePaste}>
            <Clipboard className="h-5 w-5" /> Paste
          </Button>
        </div>
      </PageContent>
    </Page>
  );
}
