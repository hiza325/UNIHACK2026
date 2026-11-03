import QRCode from 'qrcode';

export async function generateQRDataUrl(text) {
  if (!text || typeof text !== 'string') throw new Error('QR text required');
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 256,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
