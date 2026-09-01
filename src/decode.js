import jsQR from 'jsqr';
import QrScanner from 'qr-scanner/qr-scanner.legacy.min.js';
import { classifyUrl } from './url.js';

const MAX_MAIN_THREAD_PIXELS = 1200000;

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
}

export function canUseMainThreadDecoder(imageData) {
  return imageData.width * imageData.height <= MAX_MAIN_THREAD_PIXELS;
}

function imageDataToCanvas(imageData) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.putImageData(new ImageData(imageData.data, imageData.width, imageData.height), 0, 0);
  return canvas;
}

export async function decodeImageData(imageData, { signal, decoder = jsQR, qrDecoder = QrScanner, canvasFactory = imageDataToCanvas } = {}) {
  throwIfAborted(signal);
  if (!imageData?.data || !imageData.width || !imageData.height) return null;
  const canvas = canvasFactory(imageData);
  if (canvas && qrDecoder?.scanImage) {
    throwIfAborted(signal);
    try {
      const result = await qrDecoder.scanImage(canvas, { returnDetailedScanResult: true });
      if (result?.data) return { ...classifyUrl(result.data), raw: result.data };
    } catch {
      // Both decoders missed this candidate; the caller can try the next one.
    }
  }
  if (canUseMainThreadDecoder(imageData)) {
    throwIfAborted(signal);
    try {
      const result = decoder(imageData.data, imageData.width, imageData.height);
      if (result?.data) return { ...classifyUrl(result.data), raw: result.data };
    } catch {
      // The worker already missed; treat a jsQR error as a candidate miss.
    }
  }
  return null;
}
