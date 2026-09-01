import { hasArea } from './selection.js';
import { intersectRects } from './geometry.js';
import { cropRectForElement, upscaleFactor } from './scale.js';

const MAX_MEDIA_CANDIDATES = 8;
const MAX_RASTER_SIDE = 2048;
const RESOURCE_TIMEOUT_MS = 4000;

export { intersectRects };

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

function drawSource(source, width, height) {
  const size = rasterSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建图片画布。');
  context.drawImage(source, 0, 0, size.width, size.height);
  return readCanvas(canvas);
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

async function captureImage(image, signal) {
  throwIfAborted(signal);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return null;
  try {
    return drawSource(image, width, height);
  } catch {
    const sourceUrl = image.currentSrc || image.src;
    if (!sourceUrl) return null;
    const blob = await gmRequestBlob(sourceUrl, signal);
    const fetchedImage = await loadBlobImage(blob);
    return drawSource(fetchedImage, fetchedImage.naturalWidth, fetchedImage.naturalHeight);
  }
}

async function captureSvg(svg, signal) {
  throwIfAborted(signal);
  const bounds = svg.getBoundingClientRect();
  if (!hasArea({ width: bounds.width, height: bounds.height }, 1)) return null;
  const source = new XMLSerializer().serializeToString(svg);
  const image = await loadBlobImage(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  return drawSource(image, bounds.width, bounds.height);
}

function mediaScore(element, bounds, overlap) {
  const squareScore = Math.min(bounds.width, bounds.height) / Math.max(bounds.width, bounds.height);
  const coverage = (overlap.width * overlap.height) / (bounds.width * bounds.height);
  const kindScore = element instanceof HTMLCanvasElement ? 0.2 : element instanceof HTMLImageElement ? 0.1 : 0;
  return squareScore + coverage + kindScore;
}

function collectCandidates(rect) {
  return [...document.querySelectorAll('img, canvas, svg')]
    .map(element => {
      const bounds = element.getBoundingClientRect();
      const overlap = intersectRects(rect, { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height });
      return { element, bounds, overlap };
    })
    .filter(({ bounds, overlap }) => bounds.width >= 24 && bounds.height >= 24 && hasArea(overlap, 1))
    .sort((a, b) => mediaScore(b.element, b.bounds, b.overlap) - mediaScore(a.element, a.bounds, a.overlap))
    .slice(0, MAX_MEDIA_CANDIDATES);
}

async function captureCandidate(element, signal) {
  if (element instanceof HTMLImageElement) return captureImage(element, signal);
  if (element instanceof HTMLCanvasElement) return drawSource(element, element.width, element.height);
  if (element instanceof SVGElement) return captureSvg(element, signal);
  return null;
}

export async function* captureVisiblePage({ rect, signal } = {}) {
  if (!rect || !hasArea(rect, 1)) throw new Error('请选择一个有内容的区域。');
  throwIfAborted(signal);
  const candidates = collectCandidates(rect);
  if (!candidates.length) throw new Error('选定区域中没有可读取的图片、Canvas 或 SVG。');
  let yielded = false;
  for (const { element } of candidates) {
    throwIfAborted(signal);
    try {
      const imageData = await captureCandidate(element, signal);
      if (imageData) { yielded = true; yield imageData; }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }
  if (!yielded) throw new Error('无法读取选定区域中的图片内容。');
}
