import jsQR from 'jsqr';
import { classifyUrl } from './url.js';
import { upscaleFactor, MIN_DECODE_SIDE } from './scale.js';

// jsQR cost grows superlinearly: ~813ms at 1920x1080, ~12s at 3000x2000 on the
// main thread. Cropping to the selection normally brings inputs far below this
// gate; anything still above it would freeze the page, so we skip it instead.
export const MAX_MAIN_THREAD_PIXELS = 1200000;

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
}

export function canUseMainThreadDecoder(imageData) {
  return imageData.width * imageData.height <= MAX_MAIN_THREAD_PIXELS;
}

function toResult(text) {
  return { ...classifyUrl(text), raw: text };
}

/**
 * Native QR detection. Independent implementation from jsQR and usually
 * hardware-accelerated, at zero bundle cost. Chrome/Edge support qr_code;
 * Firefox and Safari do not, so jsQR remains the workhorse.
 */
async function tryNativeDetector(imageData, { detectorFactory, canvasFactory }) {
  const factory = detectorFactory
    ?? (typeof BarcodeDetector !== 'undefined' ? () => new BarcodeDetector({ formats: ['qr_code'] }) : null);
  if (!factory) return null;
  const canvas = canvasFactory(imageData);
  if (!canvas) return null;
  try {
    const detector = factory();
    const codes = await detector.detect(canvas);
    const value = codes?.find(code => code?.rawValue)?.rawValue;
    return value ? toResult(value) : null;
  } catch {
    // Unsupported format, detached canvas, or a detector that throws on
    // this input. jsQR still gets its turn.
    return null;
  }
}

function runJsQR(decoder, imageData, inversionAttempts) {
  try {
    const result = decoder(imageData.data, imageData.width, imageData.height, { inversionAttempts });
    return result?.data ? toResult(result.data) : null;
  } catch {
    // jsQR throws on some malformed inputs; treat it as a miss so the
    // caller can try the next strategy.
    return null;
  }
}

function upscaleImageData(imageData, factor, canvasFactory) {
  if (factor <= 1) return null;
  if (typeof document === 'undefined') return null;
  const source = canvasFactory(imageData);
  if (!source) return null;
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width * factor;
  canvas.height = imageData.height * factor;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  // Smoothing blurs the black/white module boundaries that binarization
  // depends on, so keep the edges hard.
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
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

/**
 * Try progressively more expensive strategies on one candidate's pixels,
 * stopping at the first hit and respecting the caller's time budget.
 *
 * 1. native BarcodeDetector - different algorithm, usually fastest
 * 2. jsQR, as-is
 * 3. jsQR, upscaled - rescues codes too small for reliable binarization
 * 4. jsQR, inverted - rescues light-on-dark codes
 *
 * Inversion is a separate step rather than jsQR's 'attemptBoth' because that
 * option doubles the cost of every scan (813ms -> 1.9s at 1920x1080) to serve
 * an uncommon case. Running 'dontInvert' first keeps the common path fast.
 */
export async function decodeImageData(imageData, {
  signal,
  remainingBudget = Infinity,
  decoder = jsQR,
  canvasFactory = imageDataToCanvas,
  detectorFactory
} = {}) {
  throwIfAborted(signal);
  if (!imageData?.data || !imageData.width || !imageData.height) return null;
  if (remainingBudget <= 0) return null;

  const startedAt = Date.now();
  const budgetLeft = () => remainingBudget - (Date.now() - startedAt);

  const native = await tryNativeDetector(imageData, { detectorFactory, canvasFactory });
  if (native) return native;

  throwIfAborted(signal);
  if (budgetLeft() <= 0) return null;

  const withinGate = canUseMainThreadDecoder(imageData);
  if (withinGate) {
    const direct = runJsQR(decoder, imageData, 'dontInvert');
    if (direct) return direct;
  }

  throwIfAborted(signal);
  if (budgetLeft() <= 0) return null;

  const factor = upscaleFactor(imageData.width, imageData.height, MIN_DECODE_SIDE);
  if (factor > 1) {
    const enlarged = upscaleImageData(imageData, factor, canvasFactory);
    if (enlarged && canUseMainThreadDecoder(enlarged)) {
      const scaled = runJsQR(decoder, enlarged, 'dontInvert');
      if (scaled) return scaled;
    }
  }

  throwIfAborted(signal);
  if (budgetLeft() <= 0) return null;

  if (withinGate) {
    const inverted = runJsQR(decoder, imageData, 'onlyInvert');
    if (inverted) return inverted;
  }

  return null;
}
