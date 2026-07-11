// hexwar/core/los.js
// Elevation-aware line of sight between two tiles, custom to each pair.
//
// A sight line runs from the shooter's eye (tile elevation + EYE_HEIGHT) to
// the target's eye. We sample points along the segment between the two tile
// centers; whenever a sample lands on a *different* intermediate tile whose
// elevation pokes above the interpolated sight height at that point, the
// line is blocked.

const EYE_HEIGHT = 0.5;

/**
 * elevationOf: (tileId) -> number. Returns { ok, blocker? }.
 */
export function lineOfSight(map, fromId, toId, elevationOf) {
  const a = map.tile(fromId).center;
  const b = map.tile(toId).center;
  const eyeA = elevationOf(fromId) + EYE_HEIGHT;
  const eyeB = elevationOf(toId) + EYE_HEIGHT;

  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const stepLen = (map.meta.hexSize || 20) * 0.4;
  const steps = Math.max(4, Math.ceil(span / stepLen));

  const seen = new Set([fromId, toId]);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const tileId = map.tileAtPoint(x, y);
    if (tileId === -1 || seen.has(tileId)) continue;
    seen.add(tileId);
    const sightHeight = eyeA + (eyeB - eyeA) * t;
    if (elevationOf(tileId) > sightHeight + 1e-9) {
      return { ok: false, blocker: tileId };
    }
  }
  return { ok: true };
}
