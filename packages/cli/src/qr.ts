import QRCode from 'qrcode';

export async function toTerminal(data: string): Promise<string> {
  return QRCode.toString(data, { type: 'utf8', errorCorrectionLevel: 'M' });
}

export async function toPngBuffer(data: string): Promise<Buffer> {
  return QRCode.toBuffer(data, { errorCorrectionLevel: 'M', width: 300 });
}

export async function toPngBase64(data: string): Promise<string> {
  const buf = await toPngBuffer(data);
  return buf.toString('base64');
}

export async function toPngFile(data: string, path: string): Promise<void> {
  await QRCode.toFile(path, data, { errorCorrectionLevel: 'M', width: 300 });
}
