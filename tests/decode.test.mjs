import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseMainThreadDecoder, decodeImageData, MAX_MAIN_THREAD_PIXELS } from '../src/decode.js';

function pixels(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

test('decoder exceptions do not break the scan flow', async () => {
  // jsQR throws a TypeError when it cannot locate a finder pattern, so
  // swallowing it is a hard requirement, not defensive padding.
  const attempts = [];
  const result = await decodeImageData(pixels(600, 600), {
    decoder: (_data, _width, _height, options) => {
      attempts.push(options?.inversionAttempts);
      throw new TypeError("Cannot read properties of undefined (reading 'height')");
    }
  });
  assert.equal(result, null);
  assert.deepEqual(attempts, ['attemptBoth']);
});

test('gates decoding on the pixel budget, not the original image size', () => {
  assert.equal(canUseMainThreadDecoder({ width: 1000, height: 1000 }), true);
  assert.equal(canUseMainThreadDecoder({ width: 1600, height: 1000 }), false);
  assert.equal(MAX_MAIN_THREAD_PIXELS, 1200000);
});

test('a cropped region from a huge image still reaches the decoder', async () => {
  // The bug this fixes: a 3000x2000 source used to skip jsQR entirely.
  // Cropped to the selection, it is well under the gate and decodes.
  let called = false;
  const result = await decodeImageData(pixels(600, 600), {
    decoder: () => { called = true; return { data: 'https://example.com/cropped' }; }
  });
  assert.equal(called, true);
  assert.equal(result?.url, 'https://example.com/cropped');
});

test('skips main-thread decoding for oversized input', async () => {
  let called = false;
  const result = await decodeImageData(pixels(2000, 1500), {
    decoder: () => { called = true; return { data: 'never' }; }
  });
  // 3,000,000 px would take ~12s on the main thread and freeze the page.
  assert.equal(called, false);
  assert.equal(result, null);
});

test('asks jsQR to cover both polarities in one pass', async () => {
  // 'onlyInvert' throws on inverted input in this jsQR build, so a split
  // dontInvert/onlyInvert pair would silently drop light-on-dark support.
  const attempts = [];
  await decodeImageData(pixels(600, 600), {
    decoder: (_data, _width, _height, options) => {
      attempts.push(options?.inversionAttempts);
      return { data: 'https://example.com/either-polarity' };
    }
  });
  assert.deepEqual(attempts, ['attemptBoth']);
});

test('stops at the first hit without redundant passes', async () => {
  let calls = 0;
  const result = await decodeImageData(pixels(600, 600), {
    decoder: () => { calls++; return { data: 'https://example.com/fast' }; }
  });
  assert.equal(result?.url, 'https://example.com/fast');
  assert.equal(calls, 1);
});

test('prefers the native detector and skips jsQR on a hit', async () => {
  let jsqrCalls = 0;
  const result = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({ detect: async () => [{ rawValue: 'https://example.com/native' }] }),
    decoder: () => { jsqrCalls++; return null; }
  });
  assert.equal(result?.url, 'https://example.com/native');
  assert.equal(jsqrCalls, 0);
});

test('falls back to jsQR when the native detector finds nothing', async () => {
  const result = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({ detect: async () => [] }),
    decoder: () => ({ data: 'https://example.com/fallback' })
  });
  assert.equal(result?.url, 'https://example.com/fallback');
});

test('falls back to jsQR when the native detector throws', async () => {
  const result = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({ detect: async () => { throw new Error('unsupported'); } }),
    decoder: () => ({ data: 'https://example.com/recovered' })
  });
  assert.equal(result?.url, 'https://example.com/recovered');
});

test('an exhausted budget stops decoding before any work', async () => {
  let called = false;
  const result = await decodeImageData(pixels(600, 600), {
    remainingBudget: 0,
    decoder: () => { called = true; return { data: 'never' }; }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test('rejects empty or malformed pixel data', async () => {
  assert.equal(await decodeImageData(null, {}), null);
  assert.equal(await decodeImageData({ width: 0, height: 0 }, {}), null);
  assert.equal(await decodeImageData({ data: new Uint8ClampedArray(4) }, {}), null);
});

test('aborts when the signal is already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => decodeImageData(pixels(600, 600), { signal: controller.signal }),
    { name: 'AbortError' }
  );
});
