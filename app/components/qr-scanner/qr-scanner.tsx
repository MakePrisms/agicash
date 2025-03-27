import '~/components/qr-scanner/qr-scanner.css';
import Scanner from 'qr-scanner';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '~/hooks/use-toast';
import { useAnimatedQRDecoder } from '~/lib/cashu/animated-qr-code';
import { useLatest } from '~/lib/use-latest';

const AnimatedScanProgress = ({ progress }: { progress: number }) => {
  if (progress === 0) return null;

  return (
    <div className="absolute right-0 bottom-0 left-0 p-2">
      <div className="relative h-8 w-full rounded bg-gray-700">
        <div
          className="h-full rounded bg-secondary transition-all"
          style={{ width: `${progress * 100}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-bold text-white">
            {Math.round(progress * 100)}%
            {progress > 0.9 ? ' - Keep scanning' : ''}
          </span>
        </div>
      </div>
    </div>
  );
};

type QRScannerProps = {
  /**
   * The callback function to be called when the QR code is decoded.
   */
  onDecode: (decoded: string) => void;
};

/**
 * Scanner component that uses the camera and renders a video element.
 *
 * The scanner can read static QR codes and
 * [BC-UR](https://github.com/BlockchainCommons/UR) encoded animated QR codes.
 *
 * Calls `onDecode` with the text decoded from the QR code and toasts any errors
 * that occur during decoding.
 */
export const QRScanner = ({ onDecode }: QRScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanner = useRef<Scanner | null>(null);
  const [currentFragment, setCurrentFragment] = useState('');
  const decodeRef = useLatest(onDecode);

  const { progress, error } = useAnimatedQRDecoder({
    fragment: currentFragment,
    onDecode: (decoded) => {
      setCurrentFragment('');
      decodeRef.current(decoded);
      scanner.current?.destroy();
    },
  });
  const { toast } = useToast();

  useEffect(() => {
    error &&
      toast({
        title: 'Error decoding QR code',
        description: error.message,
        variant: 'destructive',
      });
  }, [error, toast]);

  useEffect(() => {
    const handleResult = (result: Scanner.ScanResult): void => {
      if (result.data.toLowerCase().startsWith('ur:')) {
        setCurrentFragment(result.data);
      } else {
        decodeRef.current(result.data);
        scanner.current?.destroy();
      }
    };

    if (!videoRef.current) {
      throw new Error('Expected video element to be present');
    }

    const scannerInstance = new Scanner(videoRef.current, handleResult, {
      returnDetailedScanResult: true,
      highlightScanRegion: true,
      highlightCodeOutline: true,
    });
    scanner.current = scannerInstance;

    const startedPromise = scannerInstance.start();

    return () => {
      startedPromise
        .catch((e) => {
          // Catch is there not to show this error in console https://developer.chrome.com/blog/play-request-was-interrupted.
          // This happens when useEffect is triggered twice in short amount of time. E.g. when strict mode is on.
          console.debug(e);
        })
        .finally(() => {
          scannerInstance.destroy();
        });
    };
  }, []);
  return (
    <section className="fixed inset-0 h-screen w-screen sm:relative sm:aspect-square sm:h-[400px] sm:w-[400px]">
      <div className="relative h-full w-full">
        <video
          ref={videoRef}
          aria-label="QR code scanner"
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        <AnimatedScanProgress progress={progress} />
      </div>
    </section>
  );
};
