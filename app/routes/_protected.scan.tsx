import { Clipboard } from 'lucide-react';
import {
  Page,
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { QRScanner } from '~/components/qr-scanner';
import { classifyInput } from '~/features/scan';
import { useToast } from '~/hooks/use-toast';
import { readClipboard } from '~/lib/read-clipboard';
import { useNavigateWithViewTransition } from '~/lib/transitions';

export default function ScanPage() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();

  const handleInput = (raw: string) => {
    const result = classifyInput(raw);

    switch (result.type) {
      case 'cashu-token': {
        const hash = `#${result.encoded}`;
        // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
        // See https://github.com/remix-run/remix/discussions/10721
        window.history.replaceState(null, '', hash);
        navigate(
          { pathname: '/receive/cashu/token', hash },
          { transition: 'slideLeft', applyTo: 'newView' },
        );
        break;
      }

      case 'bolt11': {
        const hash = `#${result.invoice}`;
        // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
        // See https://github.com/remix-run/remix/discussions/10721
        window.history.replaceState(null, '', hash);
        navigate(
          { pathname: '/send', hash },
          { transition: 'slideLeft', applyTo: 'newView' },
        );
        break;
      }

      case 'ln-address': {
        const hash = `#${result.address}`;
        // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
        // See https://github.com/remix-run/remix/discussions/10721
        window.history.replaceState(null, '', hash);
        navigate(
          { pathname: '/send', hash },
          { transition: 'slideLeft', applyTo: 'newView' },
        );
        break;
      }

      case 'unknown':
        toast({
          title: 'Invalid QR code',
          description:
            'Please scan a cashu token, lightning invoice, or lightning address',
          variant: 'destructive',
        });
        break;
    }
  };

  const handlePaste = async () => {
    const text = await readClipboard();
    if (text) handleInput(text);
  };

  return (
    <Page>
      <PageHeader className="z-10">
        <PageBackButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Scan</PageHeaderTitle>
      </PageHeader>
      <PageContent className="relative flex flex-col items-center justify-center gap-4">
        <QRScanner onDecode={handleInput} />
        <button
          type="button"
          onClick={handlePaste}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <Clipboard className="h-5 w-5" /> Paste
        </button>
      </PageContent>
    </Page>
  );
}
