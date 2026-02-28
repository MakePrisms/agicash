import { UR, UREncoder } from '@agicash/bc-ur';
import { useEffect, useState } from 'react';
import { useInterval } from 'usehooks-ts';

type AnimatedQREncoderProps = {
  /**
   * The text to encode.
   */
  text: string;
  /**
   * Set the size of each fragment.
   * For NGRAVE ZERO support please keep to a maximum fragment size of 200
   * @defaultValue 200
   */
  maxFragmentLength?: number;
  /**
   * The index of the fragment that will be the first to be generated.
   * If it's more than the "maxFragmentLength", then all the subsequent
   * fragments will only be fountain parts which repeat the same data by
   * combining multiple fragments using the fountain coding algorithm.
   * @defaultValue 0
   */
  firstSequenceNumber?: number;
  /**
   * The interval in milliseconds between each fragment.
   * @defaultValue 200
   */
  intervalMs?: number;
};

function u8ArrayFromUtf8(text: string): Uint8Array {
  return new Uint8Array(text.split('').map((c) => c.charCodeAt(0)));
}

/**
 * Encodes text into a sequence of [BC-UR](https://github.com/BlockchainCommons/UR) encoded fragments.
 * @returns An object containing the current fragment and a boolean indicating if the text is ready.
 *
 * @example
 * ```tsx
 * const { fragment, isReady } = useAnimatedQREncoder({ text });
 *
 * if (isReady) {
 *   return <QRCodeSVG value={fragment} />;
 * }
 * ```
 */
export function useAnimatedQREncoder({
  text,
  maxFragmentLength = 200,
  firstSequenceNumber = 0,
  intervalMs = 200,
}: AnimatedQREncoderProps) {
  const [fragment, setFragment] = useState<string>('');
  const [encoder, setEncoder] = useState<UREncoder>();

  useEffect(() => {
    const messageBuffer = u8ArrayFromUtf8(text);
    // @ts-expect-error - expects Buffer, but Uint8Array works
    const ur = UR.fromBuffer(messageBuffer);
    const instance = new UREncoder(ur, maxFragmentLength, firstSequenceNumber);
    setEncoder(instance);
  }, [text, maxFragmentLength, firstSequenceNumber]);

  useInterval(
    () => {
      if (encoder) {
        setFragment(encoder.nextPart());
      }
    },
    encoder ? intervalMs : null,
  );

  return {
    fragment,
    isReady: Boolean(encoder) && fragment.length > 0,
  };
}
