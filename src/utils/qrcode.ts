import QRCode from 'qrcode'

export async function toQrDataUrl(value: string, width = 160): Promise<string> {
  const text = value.trim()
  if (!text) return ''
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width,
    color: { dark: '#000000', light: '#ffffff' },
  })
}
