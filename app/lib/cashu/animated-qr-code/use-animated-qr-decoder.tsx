import { URDecoder } from '@jbojcic/bc-ur';
import { useEffect, useState } from 'react';
import { useLatest } from '~/lib/use-latest';

type AnimatedQRDecoderProps = {
  /**
   * The current fragment from a bc-ur encoded animated QR code.
   * @example
   * "ur:bytes/1-9/lpadascfadaxcywenbpljkhdcahkadaemejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtdkgslpgh"
   */
  fragment: string;
  /**
   * The callback function to be called when the fragment is decoded.
   */
  onDecode: (decodedText: string) => void;
};

type AnimatedQRDecoderReturn = {
  /**
   * The percentage of fragments that have been decoded, from 0 to 1.
   */
  progress: number;
  /**
   * Any error that occurred during decoding.
   */
  error: Error | null;
};

/**
 * Decodes a sequence of [BC-UR](https://github.com/BlockchainCommons/UR) encoded fragments.
 * @returns An object containing the progress and error.
 *
 * @example
 * ```tsx
 * const onDecode = (decodedText: string) => {
 *   console.log(decodedText);
 * };
 *
 * const fragment = scanQRCode();
 *
 * const { progress, error } = useAnimatedQRDecoder({ fragment, onDecode });
 * ```
 */
export function useAnimatedQRDecoder({
  fragment,
  onDecode,
}: AnimatedQRDecoderProps): AnimatedQRDecoderReturn {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [decoder] = useState(() => new URDecoder());
  const decodeRef = useLatest(onDecode);

  useEffect(() => {
    if (fragment === '') return;

    try {
      decoder.receivePart(fragment);
      setProgress(decoder.estimatedPercentComplete() || 0);

      if (decoder.isComplete() && decoder.isSuccess()) {
        const ur = decoder.resultUR();
        const decoded = ur.decodeCBOR().toString();
        decodeRef.current(decoded);
      }
    } catch (e) {
      const message = 'Failed to decode QR fragment';
      console.error(message, { cause: e });
      setError(e instanceof Error ? e : new Error(message));
    }
  }, [fragment, decoder]);

  return {
    progress,
    error,
  };
}
