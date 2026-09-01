import { intersectRects } from './geometry.js';

// Below this, jsQR struggles to resolve module edges on dense codes.
export const MIN_DECODE_SIDE = 512;

/**
 * Map a viewport-space selection onto an element's own pixel grid.
 *
 * Returns null whenever cropping would be wrong or pointless, in which case
 * the caller must decode the whole element:
 * - `objectFit` other than 'fill': the image is letterboxed or clipped inside
 *   its box, so display-to-natural scaling does not hold. Cropping by ratio
 *   would cut the wrong region, which is worse than not cropping at all.
 * - selection covers the element entirely: nothing to trim.
 * - empty intersection: caller should skip the element, not crop it to nothing.
 */
export function cropRectForElement(selectionRect, bounds, naturalSize, objectFit = 'fill') {
  if (objectFit && objectFit !== 'fill') return null;
  if (!bounds?.width || !bounds?.height) return null;
  if (!naturalSize?.width || !naturalSize?.height) return null;

  const box = { x: bounds.left ?? bounds.x, y: bounds.top ?? bounds.y, width: bounds.width, height: bounds.height };
  const overlap = intersectRects(selectionRect, box);
  if (overlap.width <= 0 || overlap.height <= 0) return null;

  const coversWidth = overlap.width >= box.width;
  const coversHeight = overlap.height >= box.height;
  if (coversWidth && coversHeight) return null;

  const scaleX = naturalSize.width / box.width;
  const scaleY = naturalSize.height / box.height;
  const sx = Math.max(0, Math.round((overlap.x - box.x) * scaleX));
  const sy = Math.max(0, Math.round((overlap.y - box.y) * scaleY));
  const sw = Math.min(naturalSize.width - sx, Math.round(overlap.width * scaleX));
  const sh = Math.min(naturalSize.height - sy, Math.round(overlap.height * scaleY));
  if (sw < 1 || sh < 1) return null;
  return { sx, sy, sw, sh };
}

/**
 * Integer factor that lifts the shortest side to at least `minSide`.
 * Integer factors keep module edges aligned to whole pixels; fractional
 * scaling smears them even with smoothing disabled.
 */
export function upscaleFactor(width, height, minSide = MIN_DECODE_SIDE) {
  if (!width || !height) return 1;
  const shortest = Math.min(width, height);
  if (shortest >= minSide) return 1;
  return Math.max(1, Math.ceil(minSide / shortest));
}
