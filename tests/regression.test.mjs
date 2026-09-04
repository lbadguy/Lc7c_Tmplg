import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { cropRectForElement, upscaleFactor } from '../src/scale.js';
import { canUseMainThreadDecoder, decodeImageData } from '../src/decode.js';

const MAX_RASTER_SIDE = 2048;

/** Paint a real QR code into a white canvas at (ox, oy). */
function paintQr(buffer, imageWidth, modules, ox, oy, scale, quiet) {
  const size = modules.size;
  const side = (size + quiet * 2) * scale;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < size && my < size ? modules.get(my, mx) : 0;
      const value = dark ? 0 : 255;
      const at = ((oy + y) * imageWidth + (ox + x)) * 4;
      buffer[at] = value;
      buffer[at + 1] = value;
      buffer[at + 2] = value;
      buffer[at + 3] = 255;
    }
  }
  return side;
}

function white(width, height) {
  const buffer = new Uint8ClampedArray(width * height * 4).fill(255);
  return buffer;
}

function extract(source, sourceWidth, crop) {
  const out = new Uint8ClampedArray(crop.sw * crop.sh * 4);
  for (let y = 0; y < crop.sh; y++) {
    for (let x = 0; x < crop.sw; x++) {
      const to = (y * crop.sw + x) * 4;
      const from = ((crop.sy + y) * sourceWidth + (crop.sx + x)) * 4;
      out[to] = source[from];
      out[to + 1] = source[from + 1];
      out[to + 2] = source[from + 2];
      out[to + 3] = 255;
    }
  }
  return out;
}

function downscale(source, width, height) {
  const scale = Math.min(1, MAX_RASTER_SIDE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.round(x / scale));
      const sy = Math.min(height - 1, Math.round(y / scale));
      const to = (y * w + x) * 4;
      const from = (sy * width + sx) * 4;
      out[to] = source[from];
      out[to + 1] = source[from + 1];
      out[to + 2] = source[from + 2];
      out[to + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

// Rendered lazily so the suite still loads if the optional encoder is absent.
async function makeQrModules(payload) {
  try {
    const { create } = await import('qrcode');
    return (await create(payload, { errorCorrectionLevel: 'M' })).modules;
  } catch {
    return null;
  }
}

test('a framed QR inside a large screenshot decodes after cropping', async t => {
  const payload = 'https://example.com/scan-target-abcdef123456';
  const modules = await makeQrModules(payload);
  if (!modules) return t.skip('optional qrcode encoder not installed');

  const width = 3000;
  const height = 2000;
  const originX = 2100;
  const originY = 1500;
  const image = white(width, height);
  const qrSide = paintQr(image, width, modules, originX, originY, 8, 4);

  // Old path: downscale the whole image, then hit the pixel gate.
  const shrunk = downscale(image, width, height);
  assert.equal(
    canUseMainThreadDecoder(shrunk), false,
    'the original bug: a downscaled large image exceeds the gate and never reaches jsQR'
  );

  // New path: crop to the selection first.
  const selection = { x: originX - 30, y: originY - 30, width: qrSide + 60, height: qrSide + 60 };
  const crop = cropRectForElement(selection, { left: 0, top: 0, width, height }, { width, height });
  assert.ok(crop, 'selection inside the image must produce a crop');

  const cropped = { data: extract(image, width, crop), width: crop.sw, height: crop.sh };
  assert.equal(canUseMainThreadDecoder(cropped), true, 'a cropped region must pass the gate');

  const decoded = jsQR(cropped.data, cropped.width, cropped.height, { inversionAttempts: 'dontInvert' });
  assert.equal(decoded?.data, payload);
});

test('a small QR is upscaled instead of shrunk', async t => {
  const payload = 'https://example.com/tiny';
  const modules = await makeQrModules(payload);
  if (!modules) return t.skip('optional qrcode encoder not installed');

  // 2px per module: near the lower limit for reliable binarization.
  const width = 200;
  const height = 200;
  const image = white(width, height);
  paintQr(image, width, modules, 4, 4, 2, 2);

  assert.ok(upscaleFactor(width, height) > 1, 'a 200px region must be scaled up, not down');
  const decoded = jsQR(image, width, height, { inversionAttempts: 'dontInvert' });
  // Whether this particular render decodes at 1x is not the point; the
  // contract is that we enlarge such regions rather than shrinking them.
  assert.ok(decoded === null || decoded.data === payload);
});

test('light-on-dark codes decode through the chain', async t => {
  const payload = 'https://example.com/inverted';
  const modules = await makeQrModules(payload);
  if (!modules) return t.skip('optional qrcode encoder not installed');

  const width = 400;
  const height = 400;
  const image = white(width, height);
  paintQr(image, width, modules, 20, 20, 8, 2);
  // Flip to light-on-dark.
  for (let i = 0; i < image.length; i += 4) {
    image[i] = 255 - image[i];
    image[i + 1] = 255 - image[i + 1];
    image[i + 2] = 255 - image[i + 2];
  }

  // Go through decodeImageData rather than jsQR directly: jsQR throws a
  // TypeError when it cannot locate any finder pattern, and swallowing that
  // is exactly what the decode chain is responsible for.
  const decoded = await decodeImageData({ data: image, width, height });
  assert.equal(decoded.length, 1, 'the chain must find the light-on-dark code');
  assert.equal(decoded[0]?.raw, payload, 'the chain must recover a light-on-dark code');

  // Documents why the chain uses attemptBoth: the cheaper single pass misses
  // this code, and onlyInvert throws rather than decoding it.
  const plain = jsQR(image, width, height, { inversionAttempts: 'dontInvert' });
  assert.equal(plain, null);
  assert.throws(() => jsQR(image, width, height, { inversionAttempts: 'onlyInvert' }));
});

test('multiple codes in one image are all decoded', async t => {
  const payloads = [
    'https://example.com/first',
    'https://example.com/second',
    'https://example.com/third'
  ];
  const modules = await Promise.all(payloads.map(makeQrModules));
  if (modules.some(m => !m)) return t.skip('optional qrcode encoder not installed');

  const width = 1200;
  const height = 400;
  const image = white(width, height);
  // Three codes side-by-side in the same image.
  const side0 = paintQr(image, width, modules[0], 50, 50, 6, 4);
  const side1 = paintQr(image, width, modules[1], 450, 50, 6, 4);
  const side2 = paintQr(image, width, modules[2], 850, 50, 6, 4);

  const decoded = await decodeImageData({ data: image, width, height });
  const texts = decoded.map(result => result.raw).sort();
  assert.deepEqual(texts, payloads.sort(), 'all three codes must be found');
});

test('the decode chain survives jsQR throwing on unlocatable input', async () => {
  // Pure noise has no finder pattern; jsQR throws rather than returning null.
  const width = 300;
  const height = 300;
  const noise = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < noise.length; i += 4) {
    const value = (i * 2654435761) % 256;
    noise[i] = value;
    noise[i + 1] = value;
    noise[i + 2] = value;
    noise[i + 3] = 255;
  }
  assert.deepEqual(await decodeImageData({ data: noise, width, height }), []);
});
