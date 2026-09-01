import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectRects } from '../src/geometry.js';
import { cropRectForElement, upscaleFactor, MIN_DECODE_SIDE } from '../src/scale.js';
import { normalizeSelection, hasArea } from '../src/selection.js';

test('intersects a selected region with a visible media element', () => {
  assert.deepEqual(
    intersectRects(
      { x: 100, y: 50, width: 300, height: 200 },
      { x: 250, y: 0, width: 200, height: 180 }
    ),
    { x: 250, y: 50, width: 150, height: 130 }
  );
});

test('normalizes reverse drag and clamps to viewport', () => {
  const rect = normalizeSelection({ x: 220, y: 180 }, { x: -20, y: 40 }, { right: 200, bottom: 160 });
  assert.deepEqual(rect, { x: 0, y: 40, width: 200, height: 120 });
  assert.equal(hasArea(rect), true);
});

test('crops a selection at 1:1 display scale', () => {
  const crop = cropRectForElement(
    { x: 150, y: 120, width: 100, height: 100 },
    { left: 100, top: 100, width: 400, height: 400 },
    { width: 400, height: 400 }
  );
  assert.deepEqual(crop, { sx: 50, sy: 20, sw: 100, sh: 100 });
});

test('scales crop coordinates when display size differs from natural size', () => {
  // A 2000x2000 image shown at 500x500: every display pixel is 4 natural pixels.
  const crop = cropRectForElement(
    { x: 200, y: 200, width: 100, height: 100 },
    { left: 100, top: 100, width: 500, height: 500 },
    { width: 2000, height: 2000 }
  );
  assert.deepEqual(crop, { sx: 400, sy: 400, sw: 400, sh: 400 });
});

test('returns null when the selection covers the whole element', () => {
  const crop = cropRectForElement(
    { x: 0, y: 0, width: 1000, height: 1000 },
    { left: 100, top: 100, width: 400, height: 400 },
    { width: 400, height: 400 }
  );
  assert.equal(crop, null);
});

test('returns null on empty intersection', () => {
  const crop = cropRectForElement(
    { x: 0, y: 0, width: 50, height: 50 },
    { left: 500, top: 500, width: 200, height: 200 },
    { width: 200, height: 200 }
  );
  assert.equal(crop, null);
});

test('refuses to crop when object-fit breaks ratio mapping', () => {
  const selection = { x: 150, y: 120, width: 100, height: 100 };
  const bounds = { left: 100, top: 100, width: 400, height: 400 };
  const natural = { width: 800, height: 400 };
  // 'fill' stretches to the box, so ratio mapping holds.
  assert.notEqual(cropRectForElement(selection, bounds, natural, 'fill'), null);
  // These letterbox or clip the image; cropping by ratio would cut the wrong region.
  assert.equal(cropRectForElement(selection, bounds, natural, 'cover'), null);
  assert.equal(cropRectForElement(selection, bounds, natural, 'contain'), null);
  assert.equal(cropRectForElement(selection, bounds, natural, 'none'), null);
  assert.equal(cropRectForElement(selection, bounds, natural, 'scale-down'), null);
});

test('clamps crop to the natural pixel grid', () => {
  // Selection runs past the element's right/bottom edge.
  const crop = cropRectForElement(
    { x: 300, y: 300, width: 500, height: 500 },
    { left: 100, top: 100, width: 400, height: 400 },
    { width: 400, height: 400 }
  );
  assert.equal(crop.sx + crop.sw <= 400, true);
  assert.equal(crop.sy + crop.sh <= 400, true);
});

test('crop follows the raster size, not the layout size', () => {
  // An SVG with viewBox="0 0 100 100" shown at 400x400, or a refetched image
  // variant smaller than the one on the page. Using layout size here would
  // place the source rect outside the bitmap and read blank pixels.
  const selection = { x: 100, y: 100, width: 200, height: 200 };
  const bounds = { left: 0, top: 0, width: 400, height: 400 };

  const wrong = cropRectForElement(selection, bounds, { width: 400, height: 400 });
  assert.deepEqual(wrong, { sx: 100, sy: 100, sw: 200, sh: 200 });

  const right = cropRectForElement(selection, bounds, { width: 100, height: 100 });
  assert.deepEqual(right, { sx: 25, sy: 25, sw: 50, sh: 50 });
  assert.ok(right.sx + right.sw <= 100, 'crop must stay inside the actual raster');
});

test('rejects degenerate element sizes', () => {
  const selection = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(cropRectForElement(selection, { left: 0, top: 0, width: 0, height: 100 }, { width: 10, height: 10 }), null);
  assert.equal(cropRectForElement(selection, { left: 0, top: 0, width: 100, height: 100 }, { width: 0, height: 10 }), null);
});

test('upscales small crops to the decoder floor', () => {
  assert.equal(upscaleFactor(128, 128), 4);
  assert.equal(upscaleFactor(200, 150), 4);
  assert.equal(upscaleFactor(MIN_DECODE_SIDE, MIN_DECODE_SIDE), 1);
});

test('never downscales via upscaleFactor', () => {
  assert.equal(upscaleFactor(2000, 1500), 1);
  assert.equal(upscaleFactor(0, 0), 1);
});
