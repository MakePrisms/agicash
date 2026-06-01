// NUT-16 - animated QR code: https://github.com/cashubtc/nuts/blob/main/16.md

import { QRCodeSVG } from 'qrcode.react';
import { useAnimatedQREncoder } from './use-animated-qr-encoder';

type QRCodeSVGProps = Parameters<typeof QRCodeSVG>[0];

type AnimatedQRCodeProps = QRCodeSVGProps & {
  /**
   * The value to encode into the QR Code.
   */
  value: string;
};

export function AnimatedQRCode({
  value,
  size = 275,
  ...props
}: AnimatedQRCodeProps) {
  const { fragment, isReady } = useAnimatedQREncoder({ text: value });

  if (isReady) {
    return <QRCodeSVG value={fragment} size={size} {...props} />;
  }
}
