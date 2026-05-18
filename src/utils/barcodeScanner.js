import { Html5QrcodeSupportedFormats } from 'html5-qrcode'

export const BARCODE_FORMATS_TO_SUPPORT = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.QR_CODE,
]

export const BARCODE_READER_CONFIG = {
  formatsToSupport: BARCODE_FORMATS_TO_SUPPORT,
  useBarCodeDetectorIfSupported: true,
}

export const BARCODE_SCAN_CONFIG = {
  fps: 10,
  disableFlip: false,
  aspectRatio: 1.777778,
  qrbox: (width, height) => ({
    width: Math.min(Math.floor(width * 0.95), 640),
    height: Math.min(Math.floor(height * 0.6), 260),
  }),
}

export function normalizeBarcodeText(value) {
  return String(value ?? '').replace(/\s+/g, '').trim()
}

export async function stopBarcodeScanner(scanner) {
  if (!scanner) return
  try {
    await scanner.stop()
  } catch {
    // html5-qrcode can throw when stop is called before start fully resolves.
  }
}
