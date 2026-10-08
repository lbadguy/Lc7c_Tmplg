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

function toResult(text, location = null) {
  return { ...classifyUrl(text), raw: text, location };
}

/**
 * Native QR detection. Independent implementation from jsQR and usually
 * hardware-accelerated, at zero bundle cost. Chrome/Edge support qr_code;
 * Firefox and Safari do not, so jsQR remains the workhorse.
 */
async function tryNativeDetector(imageData, { detectorFactory, canvasFactory }) {
  const factory = detectorFactory
    ?? (typeof BarcodeDetector !== 'undefined' ? () => new BarcodeDetector({ formats: ['qr_code'] }) : null);
  if (!factory) return [];
  const canvas = canvasFactory(imageData);
  if (!canvas) return [];
  try {
    const detector = factory();
    const codes = await detector.detect(canvas);
    // The native detector reports every code in one pass, which is exactly
    // what we want here - no masking loop needed.
    return (codes ?? [])
      .filter(code => code?.rawValue)
      .map(code => toResult(code.rawValue, boundingBoxOf(code)));
  } catch {
    // Unsupported format, detached canvas, or a detector that throws on
    // this input. jsQR still gets its turn.
    return [];
  }
}

function boundingBoxOf(code) {
  const box = code?.boundingBox;
  if (box && Number.isFinite(box.x) && Number.isFinite(box.y)) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  const points = code?.cornerPoints;
  if (!Array.isArray(points) || !points.length) return null;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const MIN_WINDOW_SIDE = 160;
const MAX_WINDOWS = 24;
// Cap tile side so every tile stays under the main-thread pixel budget.
const MAX_TILE_SIDE = Math.floor(Math.sqrt(MAX_MAIN_THREAD_PIXELS * 0.95));

function* tilesFor(width, height) {
  const shortEdge = Math.min(width, height);
  const side = Math.min(MAX_TILE_SIDE, Math.max(MIN_WINDOW_SIDE, Math.round(shortEdge * 0.9)));
  if (side >= width && side >= height) return;
  const step = Math.max(1, Math.round(side / 2));
  const xs = offsets(width, side, step);
  const ys = offsets(height, side, step);
  let emitted = 0;
  for (const sy of ys) {
    for (const sx of xs) {
      if (++emitted > MAX_WINDOWS) return;
      yield { sx, sy, sw: Math.min(side, width - sx), sh: Math.min(side, height - sy) };
    }
  }
}

function offsets(total, side, step) {
  if (side >= total) return [0];
  const list = [];
  for (let start = 0; start + side < total; start += step) list.push(start);
  list.push(total - side);
  return list;
}

function extractTile(imageData, { sx, sy, sw, sh }) {
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const to = (y * sw + x) * 4;
      const from = ((sy + y) * imageData.width + (sx + x)) * 4;
      out[to] = imageData.data[from];
      out[to + 1] = imageData.data[from + 1];
      out[to + 2] = imageData.data[from + 2];
      out[to + 3] = imageData.data[from + 3];
    }
  }
  return { data: out, width: sw, height: sh };
}

function runJsQR(decoder, imageData, inversionAttempts) {
  try {
    const result = decoder(imageData.data, imageData.width, imageData.height, { inversionAttempts });
    return result?.data ? toResult(result.data, result.location) : null;
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

/**
 * Downscale an oversized ImageData to fit under MAX_MAIN_THREAD_PIXELS so jsQR
 * can process it. Nearest-neighbor scaling (imageSmoothingEnabled=false) keeps
 * QR module edges sharp.
 */
function rescaleForDecoder(imageData, canvasFactory) {
  const pixels = imageData.width * imageData.height;
  if (pixels <= MAX_MAIN_THREAD_PIXELS) return imageData;
  if (typeof document === 'undefined') return null;
  const scale = Math.sqrt(MAX_MAIN_THREAD_PIXELS * 0.95 / pixels);
  const w = Math.max(1, Math.round(imageData.width * scale));
  const h = Math.max(1, Math.round(imageData.height * scale));
  const source = canvasFactory(imageData);
  if (!source) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
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

// BarcodeDetector reports all codes in one pass; jsQR cannot reliably locate
// codes when multiple are present in the same image, so the masking loop is
// omitted from the jsQR path.
const MAX_CODES_PER_IMAGE = 10;

/**
 * Find QR codes in one candidate's pixels, respecting the caller's time budget.
 * Returns an array, empty when nothing decodes.
 *
 * 1. native BarcodeDetector - reports all codes in a single call
 * 2. jsQR with 'attemptBoth' - finds one code (multiple codes in the same image
 *    confuse its locator, so no masking loop)
 * 3. jsQR upscaled - rescues codes too small for reliable binarization
 *
 * 'attemptBoth' rather than separate 'dontInvert'/'onlyInvert': measured on this
 * jsQR build, 'onlyInvert' throws on inverted input instead of decoding it, so
 * splitting silently drops light-on-dark support. The feared cost does not
 * materialize - on a code that decodes, 'attemptBoth' returns on the first pass
 * (~10ms at 400x400, same as 'dontInvert'). Only unlocatable input pays for two
 * passes, bounded by the pixel gate and the time budget.
 */
export async function decodeImageData(imageData, {
  signal,
  remainingBudget = Infinity,
  decoder = jsQR,
  canvasFactory = imageDataToCanvas,
  detectorFactory
} = {}) {
  throwIfAborted(signal);
  if (!imageData?.data || !imageData.width || !imageData.height) return [];
  if (remainingBudget <= 0) return [];

  const startedAt = Date.now();
  const budgetLeft = () => remainingBudget - (Date.now() - startedAt);

  const found = [];
  const seen = new Set();
  const collect = result => {
    if (!result || seen.has(result.raw)) return;
    seen.add(result.raw);
    found.push(result);
  };

  (await tryNativeDetector(imageData, { detectorFactory, canvasFactory })).forEach(collect);

  throwIfAborted(signal);
  if (budgetLeft() <= 0) return found;

  // Fast path: try the full image once. When the image exceeds the pixel gate,
  // downscale it so jsQR still gets a shot — the previous code silently skipped
  // jsQR entirely for large images, which is why big WeChat QR codes failed.
  {
    const decodable = canUseMainThreadDecoder(imageData)
      ? imageData
      : rescaleForDecoder(imageData, canvasFactory);
    if (decodable) {
      const hit = runJsQR(decoder, decodable, 'attemptBoth');
      if (hit) collect(hit);
    }
  }

  throwIfAborted(signal);
  if (found.length || budgetLeft() <= 0) return found;

  // Slow path: subdivide into overlapping windows so each code lands cleanly
  // in at least one tile. Tile size is capped by MAX_TILE_SIDE so every tile
  // fits the main-thread pixel budget — the previous gate on the FULL image
  // size prevented tiling from ever running on the images that needed it most.
  for (const tile of tilesFor(imageData.width, imageData.height)) {
    throwIfAborted(signal);
    if (budgetLeft() <= 0) return found;
    const tileData = extractTile(imageData, tile);
    const hit = runJsQR(decoder, tileData, 'attemptBoth');
    if (hit) collect(hit);
  }

  throwIfAborted(signal);
  if (found.length || budgetLeft() <= 0) return found;

  const factor = upscaleFactor(imageData.width, imageData.height, MIN_DECODE_SIDE);
  if (factor > 1) {
    const enlarged = upscaleImageData(imageData, factor, canvasFactory);
    if (enlarged && canUseMainThreadDecoder(enlarged)) {
      const hit = runJsQR(decoder, enlarged, 'attemptBoth');
      if (hit) collect(hit);
    }
  }

  return found;
}
