import '~/components/qr-scanner/qr-scanner.css';
import Scanner from 'qr-scanner';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '~/hooks/use-toast';
import { useAnimatedQRDecoder } from '~/lib/cashu/animated-qr-code';
import { useThrottle } from '~/lib/use-throttle';

const DECODE_COOLDOWN_MS = 3000;

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
  onDecode: (decoded: string) => void;
};

/**
 * Scanner component that uses the camera and renders a video element.
 *
 * The scanner can read static QR codes and
 * [BC-UR](https://github.com/BlockchainCommons/UR) encoded animated QR codes.
 *
 * Calls `onDecode` with the text decoded from the QR code (throttled to prevent
 * spam) and toasts any errors that occur during decoding. To stop scanning,
 * unmount the component (e.g. by navigating away).
 */
export const QRScanner = ({ onDecode }: QRScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentFragment, setCurrentFragment] = useState('');

  // Leading-edge only: the scanner fires continuously, so the next leading
  // edge after the cooldown naturally handles retries. Trailing would cause
  // a second invocation while the first async handler is still in-flight.
  const throttledDecode = useThrottle(onDecode, DECODE_COOLDOWN_MS, {
    trailing: false,
  });

  const { progress, error } = useAnimatedQRDecoder({
    fragment: currentFragment,
    onDecode: (decoded) => {
      setCurrentFragment('');
      throttledDecode(decoded);
    },
  });

  const { toast } = useToast();

  useEffect(() => {
    if (error) {
      toast({
        title: 'Error decoding QR code',
        description: error.message,
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  useEffect(() => {
    const handleResult = (result: Scanner.ScanResult): void => {
      if (result.data.toLowerCase().startsWith('ur:')) {
        setCurrentFragment(result.data);
      } else {
        throttledDecode(result.data);
      }
    };

    if (!videoRef.current) {
      throw new Error('Expected video element to be present');
    }

    const scannerInstance = new Scanner(videoRef.current, handleResult, {
      returnDetailedScanResult: true,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      calculateScanRegion: (video) => {
        const smallestDimension = Math.min(video.videoWidth, video.videoHeight);
        const scanRegionSize = Math.round((2 / 3) * smallestDimension);
        return {
          x: Math.round((video.videoWidth - scanRegionSize) / 2),
          y: Math.round((video.videoHeight - scanRegionSize) / 2),
          width: scanRegionSize,
          height: scanRegionSize,
          downScaledWidth: 1024,
          downScaledHeight: 1024,
        };
      },
    });

    scannerInstance.start();

    return () => {
      scannerInstance.destroy();
    };
  }, [throttledDecode]);

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
