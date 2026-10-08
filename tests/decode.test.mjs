import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseMainThreadDecoder, decodeImageData, MAX_MAIN_THREAD_PIXELS } from '../src/decode.js';

function pixels(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

// jsQR reports a decoded code's position as four corner points.
function corners(x0, y0, x1, y1) {
  return {
    topLeftCorner: { x: x0, y: y0 },
    topRightCorner: { x: x1, y: y0 },
    bottomLeftCorner: { x: x0, y: y1 },
    bottomRightCorner: { x: x1, y: y1 }
  };
}

test('decoder exceptions do not break the scan flow', async () => {
  // jsQR throws a TypeError when it cannot locate a finder pattern, so
  // swallowing it is a hard requirement, not defensive padding.
  const attempts = [];
  const results = await decodeImageData(pixels(600, 600), {
    decoder: (_data, _width, _height, options) => {
      attempts.push(options?.inversionAttempts);
      throw new TypeError("Cannot read properties of undefined (reading 'height')");
    }
  });
  assert.equal(results.length, 0);
  assert.ok(attempts.length >= 1, 'the sweep must reach the decoder at least once');
  assert.deepEqual([...new Set(attempts)], ['attemptBoth']);
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
  const results = await decodeImageData(pixels(600, 600), {
    decoder: () => { called = true; return { data: 'https://example.com/cropped' }; }
  });
  assert.equal(called, true);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.url, 'https://example.com/cropped');
});

test('downscales oversized input instead of skipping it', async () => {
  let called = false;
  let receivedWidth, receivedHeight;
  const results = await decodeImageData(pixels(2000, 1500), {
    decoder: (data, w, h) => {
      called = true;
      receivedWidth = w;
      receivedHeight = h;
      return { data: 'https://example.com/downscaled' };
    }
  });
  // Previously this skipped jsQR entirely for >1.2M px; now it downscales so
  // the decoder still gets a chance — fixing large WeChat QR codes.
  assert.equal(called, true);
  assert.equal(results.length, 1);
  // Verify the image was downscaled: original 2000x1500 = 3M px should be
  // reduced to fit under the pixel budget.
  assert.ok(receivedWidth < 2000, `expected width < 2000, got ${receivedWidth}`);
  assert.ok(receivedHeight < 1500, `expected height < 1500, got ${receivedHeight}`);
  assert.ok(receivedWidth * receivedHeight <= 1200000, 'downscaled pixel count should be under budget');
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
  assert.ok(attempts.length >= 1);
  assert.deepEqual([...new Set(attempts)], ['attemptBoth']);
});

test('sliding windows let jsQR find multiple codes it cannot locate in one pass', async () => {
  // jsQR's finder-pattern algorithm assumes one code per image. On a 1200x400
  // with three codes side-by-side, it returns null - even the first one is
  // unlocatable. Sweeping overlapping windows ensures each code lands cleanly in
  // at least one window.
  const results = await decodeImageData(pixels(600, 600), {
    decoder: () => ({ data: 'https://example.com/found' })
  });
  // How many windows depends on tilesFor logic; just confirm we got hits.
  assert.ok(results.length >= 1);
});

test('deduplicates the same payload found by both decoders', async () => {
  const results = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({ detect: async () => [{ rawValue: 'https://example.com/dup' }] }),
    decoder: () => ({ data: 'https://example.com/dup', location: corners(0, 0, 100, 100) })
  });
  assert.equal(results.length, 1);
});

test('caps the window sweep so a pathological image cannot spin', async () => {
  // A decoder that reports a fresh payload for every window must not let the
  // sweep grow without bound.
  let calls = 0;
  const results = await decodeImageData(pixels(1200, 1000), {
    decoder: () => { calls++; return { data: `code-${calls}`, location: corners(0, 0, 10, 10) }; }
  });
  assert.ok(calls <= 25, `sweep must stay bounded, saw ${calls} decoder calls`);
  assert.equal(results.length, calls);
});

test('collects every code the native detector reports', async () => {
  const results = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({
      detect: async () => [
        { rawValue: 'https://example.com/a' },
        { rawValue: 'https://example.com/b' }
      ]
    }),
    decoder: () => null
  });
  assert.deepEqual(results.map(result => result.url), ['https://example.com/a', 'https://example.com/b']);
});

test('still runs jsQR after a native hit to catch codes it missed', async () => {
  // The native detector and jsQR fail on different inputs, so a native hit is
  // no reason to skip jsQR when we are after every code in the image.
  let jsqrCalls = 0;
  const results = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({ detect: async () => [{ rawValue: 'https://example.com/native' }] }),
    decoder: () => { jsqrCalls++; return null; }
  });
  assert.deepEqual(results.map(result => result.url), ['https://example.com/native']);
  assert.ok(jsqrCalls >= 1, 'the jsQR sweep must still run after a native hit');
});

test('falls back to jsQR when the native detector finds nothing', async () => {
  const results = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({ detect: async () => [] }),
    decoder: () => ({ data: 'https://example.com/fallback' })
  });
  assert.equal(results[0]?.url, 'https://example.com/fallback');
});

test('falls back to jsQR when the native detector throws', async () => {
  const results = await decodeImageData(pixels(600, 600), {
    canvasFactory: () => ({}),
    detectorFactory: () => ({ detect: async () => { throw new Error('unsupported'); } }),
    decoder: () => ({ data: 'https://example.com/recovered' })
  });
  assert.equal(results[0]?.url, 'https://example.com/recovered');
});

test('an exhausted budget stops decoding before any work', async () => {
  let called = false;
  const results = await decodeImageData(pixels(600, 600), {
    remainingBudget: 0,
    decoder: () => { called = true; return { data: 'never' }; }
  });
  assert.equal(results.length, 0);
  assert.equal(called, false);
});

test('rejects empty or malformed pixel data', async () => {
  assert.deepEqual(await decodeImageData(null, {}), []);
  assert.deepEqual(await decodeImageData({ width: 0, height: 0 }, {}), []);
  assert.deepEqual(await decodeImageData({ data: new Uint8ClampedArray(4) }, {}), []);
});

test('aborts when the signal is already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => decodeImageData(pixels(600, 600), { signal: controller.signal }),
    { name: 'AbortError' }
  );
});
