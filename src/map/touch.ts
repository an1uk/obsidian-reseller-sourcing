/** A 44 CSS-pixel target centred on each symbol keeps small pins usable by touch. */
export function nearestTouchMarker<T>(point: {x:number; y:number}, candidates: readonly T[], project: (candidate:T) => {x:number; y:number}): T | null {
  let nearest: T | null = null;
  let distance = Infinity;
  for (const candidate of candidates) {
    const projected = project(candidate);
    const dx = Math.abs(projected.x - point.x), dy = Math.abs(projected.y - point.y);
    if (!Number.isFinite(dx + dy) || dx > 22 || dy > 22) continue;
    const squared = dx * dx + dy * dy;
    if (squared < distance) { nearest = candidate; distance = squared; }
  }
  return nearest;
}
