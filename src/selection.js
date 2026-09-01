export function normalizeSelection(start, end, bounds = {}) {
  const leftBound = Number.isFinite(bounds.left) ? bounds.left : 0;
  const topBound = Number.isFinite(bounds.top) ? bounds.top : 0;
  const rightBound = Number.isFinite(bounds.right) ? bounds.right : Infinity;
  const bottomBound = Number.isFinite(bounds.bottom) ? bounds.bottom : Infinity;
  const x1 = Math.max(leftBound, Math.min(rightBound, Math.min(start.x, end.x)));
  const y1 = Math.max(topBound, Math.min(bottomBound, Math.min(start.y, end.y)));
  const x2 = Math.max(leftBound, Math.min(rightBound, Math.max(start.x, end.x)));
  const y2 = Math.max(topBound, Math.min(bottomBound, Math.max(start.y, end.y)));
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

export function hasArea(rect, minimum = 2) {
  return rect.width >= minimum && rect.height >= minimum;
}
