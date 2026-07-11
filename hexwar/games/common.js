// hexwar/games/common.js
// Setup helpers shared by the game variants.

import { dist2 } from '../core/util.js';

/**
 * Places each player's starting roster clustered around opposite sides of the
 * map (west vs east for 2 players). `isPassable(tileId)` filters spawn tiles.
 */
export function placeArmies(game, roster, isPassable = () => true) {
  const map = game.map;
  const passable = map.tiles.filter(t => isPassable(t.id));
  if (!passable.length) throw new Error('no passable tiles to spawn on');

  for (const player of game.players) {
    // anchor direction: players spread around the compass (2p = W vs E)
    const angle = Math.PI + (2 * Math.PI * player.id) / game.players.length;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let anchor = passable[0];
    let best = -Infinity;
    for (const t of passable) {
      const score = t.center[0] * dx + t.center[1] * dy;
      if (score > best) { best = score; anchor = t; }
    }
    // BFS outward from the anchor over passable, unoccupied tiles
    const queue = [anchor.id];
    const seen = new Set(queue);
    const spots = [];
    while (queue.length && spots.length < roster.length) {
      const cur = queue.shift();
      if (isPassable(cur) && !game.unitsByTile.has(cur)) spots.push(cur);
      for (const n of map.neighbors(cur)) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    roster.forEach((typeKey, i) => {
      if (spots[i] !== undefined) game.addUnit(player.id, typeKey, spots[i]);
    });
  }
}

/**
 * Marks `count` objective tiles in the contested middle band of the map,
 * spread apart by farthest-point sampling. Standing on one at the end of a
 * round scores a point (see engine._endOfRound).
 */
export function placeObjectives(game, count, isPassable = () => true) {
  const map = game.map;
  // centroid of the whole map
  let cx = 0, cy = 0;
  for (const t of map.tiles) { cx += t.center[0]; cy += t.center[1]; }
  cx /= map.size; cy /= map.size;

  const maxR = Math.max(...map.tiles.map(t => Math.hypot(t.center[0] - cx, t.center[1] - cy)));
  const band = map.tiles.filter(t =>
    isPassable(t.id) && Math.abs(t.center[0] - cx) < maxR * 0.45
  );
  if (!band.length) return;

  const chosen = [];
  // first: closest to the centroid
  let first = band[0], bd = Infinity;
  for (const t of band) {
    const d = dist2(t.center, [cx, cy]);
    if (d < bd) { bd = d; first = t; }
  }
  chosen.push(first);
  while (chosen.length < count) {
    let far = null, fd = -1;
    for (const t of band) {
      if (chosen.includes(t)) continue;
      const d = Math.min(...chosen.map(c => dist2(t.center, c.center)));
      if (d > fd) { fd = d; far = t; }
    }
    if (!far) break;
    chosen.push(far);
  }
  for (const t of chosen) t.props.objective = true;
}

/** Hop-distance based range check shared by the "strictly tile based" variants. */
export function simpleRange(range) {
  return range;
}
