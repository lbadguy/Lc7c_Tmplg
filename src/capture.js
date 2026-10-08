import { hasArea } from './selection.js';
import { intersectRects } from './geometry.js';
import { cropRectForElement } from './scale.js';

const MAX_MEDIA_CANDIDATES = 8;
const MAX_RASTER_SIDE = 2048;
const RESOURCE_TIMEOUT_MS = 4000;

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
}

function readCanvas(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法读取页面像素。');
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function rasterSize(width, height) {
  const scale = Math.min(1, MAX_RASTER_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/**
 * Rasterize a source into ImageData, optionally cropping to `crop` in the
 * source's own pixel coordinates.
 *
 * The downscale cap only applies to uncropped input, where it guards memory on
 * huge images. A crop is already selection-sized, and shrinking it would undo
 * the resolution the crop just bought us.
 */
function drawSource(source, width, height, crop = null) {
  const sourceWidth = crop ? crop.sw : width;
  const sourceHeight = crop ? crop.sh : height;
  const size = crop
    ? { width: Math.max(1, Math.round(sourceWidth)), height: Math.max(1, Math.round(sourceHeight)) }
    : rasterSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建图片画布。');
  if (crop) context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);
  else context.drawImage(source, 0, 0, size.width, size.height);
  return readCanvas(canvas);
}

function objectFitOf(element) {
  if (typeof getComputedStyle !== 'function') return 'fill';
  return getComputedStyle(element).objectFit || 'fill';
}

function gmRequestBlob(url, signal) {
  const request = typeof GM_xmlhttpRequest === 'function'
    ? GM_xmlhttpRequest
    : (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) : null);
  if (!request) return Promise.reject(new Error('Tampermonkey 跨域图片读取能力不可用。'));
  return new Promise((resolve, reject) => {
    const handle = request({
      method: 'GET',
      url,
      responseType: 'blob',
      timeout: RESOURCE_TIMEOUT_MS,
      onload(response) {
        if (response.status >= 200 && response.status < 400 && response.response) resolve(response.response);
        else reject(new Error(`图片读取失败（HTTP ${response.status || 0}）。`));
      },
      onerror() { reject(new Error('跨域图片读取失败。')); },
      ontimeout() { reject(new Error('跨域图片读取超时。')); }
    });
    signal?.addEventListener('abort', () => {
      handle?.abort?.();
      reject(new DOMException('Scan cancelled', 'AbortError'));
    }, { once: true });
  });
}

function loadBlobImage(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('无法解析图片资源。')); };
    image.src = objectUrl;
  });
}

/**
 * Resolve the best source URL for an <img>, preferring data-src (WeChat lazy
 * load) over currentSrc/src when the image hasn't been hydrated yet.
 */
function resolveImageUrl(image) {
  // WeChat articles keep the real URL in data-src; src may still be a tiny
  // placeholder GIF even after the image is visually swapped via CSS.
  const dataSrc = image.dataset?.src;
  const liveSrc = image.currentSrc || image.src;
  // Prefer data-src when src looks like a data-URI placeholder or is empty.
  if (dataSrc && (!liveSrc || liveSrc.startsWith('data:'))) return dataSrc;
  return liveSrc || dataSrc || '';
}

async function captureImage(image, rect, signal) {
  throwIfAborted(signal);
  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;
  const bounds = image.getBoundingClientRect();

  // When the image hasn't loaded yet (naturalWidth === 0) but a data-src
  // exists (WeChat lazy-load), fetch the real image directly.
  if ((!width || !height) && resolveImageUrl(image)) {
    try {
      const blob = await gmRequestBlob(resolveImageUrl(image), signal);
      const fetchedImage = await loadBlobImage(blob);
      const fw = fetchedImage.naturalWidth;
      const fh = fetchedImage.naturalHeight;
      if (fw && fh) {
        const crop = cropRectForElement(rect, bounds, { width: fw, height: fh }, objectFitOf(image));
        return drawSource(fetchedImage, fw, fh, crop);
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // Fall through – nothing more we can do.
    }
    return null;
  }

  if (!width || !height) return null;
  const crop = cropRectForElement(rect, bounds, { width, height }, objectFitOf(image));
  try {
    return drawSource(image, width, height, crop);
  } catch {
    // Tainted canvas: refetch the original bytes through Tampermonkey. The
    // refetched bitmap can differ in size from the on-page one (srcset picked a
    // different variant, or the server serves a different resolution), so
    // recompute the crop against what we actually received.
    const sourceUrl = resolveImageUrl(image);
    if (!sourceUrl) return null;
    const blob = await gmRequestBlob(sourceUrl, signal);
    const fetchedImage = await loadBlobImage(blob);
    const fetchedWidth = fetchedImage.naturalWidth || width;
    const fetchedHeight = fetchedImage.naturalHeight || height;
    const fetchedCrop = cropRectForElement(rect, bounds, { width: fetchedWidth, height: fetchedHeight }, objectFitOf(image));
    return drawSource(fetchedImage, fetchedWidth, fetchedHeight, fetchedCrop);
  }
}

async function captureSvg(svg, rect, signal) {
  throwIfAborted(signal);
  const bounds = svg.getBoundingClientRect();
  if (!hasArea({ width: bounds.width, height: bounds.height }, 1)) return null;
  const source = new XMLSerializer().serializeToString(svg);
  const image = await loadBlobImage(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  // A serialized SVG rasterizes at its own intrinsic size, which comes from its
  // width/height attributes or viewBox - not the CSS box it occupied on the
  // page. Deriving the crop from layout size would index outside the bitmap and
  // yield blank pixels, so measure the raster we actually got.
  const rasterWidth = image.naturalWidth || bounds.width;
  const rasterHeight = image.naturalHeight || bounds.height;
  const crop = cropRectForElement(rect, bounds, { width: rasterWidth, height: rasterHeight });
  return drawSource(image, rasterWidth, rasterHeight, crop);
}

function captureCanvas(canvas, rect) {
  const bounds = canvas.getBoundingClientRect();
  const crop = cropRectForElement(rect, bounds, { width: canvas.width, height: canvas.height });
  return drawSource(canvas, canvas.width, canvas.height, crop);
}

/**
 * Capture a QR code rendered as a CSS background-image. WeChat articles
 * sometimes display images this way instead of <img>.
 */
async function captureBgImage(element, rect, signal) {
  throwIfAborted(signal);
  const bgUrl = extractBgUrl(element);
  if (!bgUrl) return null;
  try {
    const blob = await gmRequestBlob(bgUrl, signal);
    const image = await loadBlobImage(blob);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return null;
    const bounds = element.getBoundingClientRect();
    const crop = cropRectForElement(rect, bounds, { width, height });
    return drawSource(image, width, height, crop);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

/** Extract url(...) from computed background-image. */
function extractBgUrl(element) {
  if (typeof getComputedStyle !== 'function') return null;
  const bg = getComputedStyle(element).backgroundImage;
  if (!bg || bg === 'none') return null;
  const match = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
  return match ? match[1] : null;
}

function mediaScore(element, bounds, overlap) {
  const squareScore = Math.min(bounds.width, bounds.height) / Math.max(bounds.width, bounds.height);
  const coverage = (overlap.width * overlap.height) / (bounds.width * bounds.height);
  const kindScore = element instanceof HTMLCanvasElement ? 0.2 : element instanceof HTMLImageElement ? 0.1 : 0;
  // Cheap candidates first: decoding a small region is far faster, so under a
  // fixed time budget this fits more attempts before giving up.
  const area = overlap.width * overlap.height;
  const cheapScore = area > 0 ? Math.min(0.3, 300000 / area * 0.3) : 0;
  return squareScore + coverage + kindScore + cheapScore;
}

const MAX_BG_SCAN_ELEMENTS = 200;

function collectCandidates(rect) {
  const entries = [...document.querySelectorAll('img, canvas, svg')]
    .map(element => {
      const bounds = element.getBoundingClientRect();
      const overlap = intersectRects(rect, { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height });
      return { element, bounds, overlap };
    })
    .filter(({ bounds, overlap }) => bounds.width >= 24 && bounds.height >= 24 && hasArea(overlap, 1));

  // Also collect elements with CSS background-image (WeChat articles often use
  // this instead of <img> for QR codes). Limit the scan to avoid perf issues.
  const seen = new Set(entries.map(e => e.element));
  const bgCandidates = [...document.querySelectorAll('div, section, span, p, a')]
    .slice(0, MAX_BG_SCAN_ELEMENTS)
    .filter(el => {
      if (seen.has(el)) return false;
      const bounds = el.getBoundingClientRect();
      if (bounds.width < 24 || bounds.height < 24) return false;
      const overlap = intersectRects(rect, { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height });
      if (!hasArea(overlap, 1)) return false;
      return extractBgUrl(el) !== null;
    })
    .map(element => {
      const bounds = element.getBoundingClientRect();
      const overlap = intersectRects(rect, { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height });
      return { element, bounds, overlap, isBgImage: true };
    });

  return [...entries, ...bgCandidates]
    .sort((a, b) => mediaScore(b.element, b.bounds, b.overlap) - mediaScore(a.element, a.bounds, a.overlap))
    .slice(0, MAX_MEDIA_CANDIDATES);
}

async function captureCandidate(element, rect, signal, isBgImage = false) {
  if (isBgImage) return captureBgImage(element, rect, signal);
  if (element instanceof HTMLImageElement) return captureImage(element, rect, signal);
  if (element instanceof HTMLCanvasElement) return captureCanvas(element, rect);
  if (element instanceof SVGElement) return captureSvg(element, rect, signal);
  return null;
}

/**
 * Yield decodable pixel buffers for the selection, cheapest candidate first.
 *
 * `stats` is mutated as we go so the caller can tell "found nothing to read"
 * apart from "read pixels but no code in them" — two failures that need
 * different messages.
 */
export async function* captureVisiblePage({ rect, signal, stats } = {}) {
  const counters = stats ?? {};
  counters.candidates = 0;
  counters.read = 0;
  counters.failed = 0;
  if (!rect || !hasArea(rect, 1)) throw new Error('请选择一个有内容的区域。');
  throwIfAborted(signal);
  const candidates = collectCandidates(rect);
  counters.candidates = candidates.length;
  if (!candidates.length) return;
  for (const { element, isBgImage } of candidates) {
    throwIfAborted(signal);
    try {
      const imageData = await captureCandidate(element, rect, signal, !!isBgImage);
      if (imageData) {
        counters.read += 1;
        yield imageData;
      } else {
        counters.failed += 1;
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      counters.failed += 1;
    }
  }
}
