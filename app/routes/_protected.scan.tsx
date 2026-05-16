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
import { classifyInput } from '~/features/scan';
import { validateBolt11 } from '~/features/send/validation';
import { useToast } from '~/hooks/use-toast';
import { readClipboard } from '~/lib/read-clipboard';
import { useNavigateWithViewTransition } from '~/lib/transitions';

export default function ScanPage() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();

  const handleInput = (raw: string) => {
    const result = classifyInput(raw);

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
      <PageHeader className="z-10">
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Scan</PageHeaderTitle>
      </PageHeader>
      <PageContent className="relative flex items-center justify-center">
        <QRScanner onDecode={handleInput} />
      </PageContent>
      <Button
        type="button"
        onClick={handlePaste}
        className="-translate-x-1/2 fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-20"
      >
        <Clipboard className="h-5 w-5" /> Paste
      </Button>
    </Page>
  );
}
