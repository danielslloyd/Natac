// hexwar/core/map.js
// Map layer for hexwar: a single TileMap abstraction over two geometries:
//   - regular hex grids  (axial coordinates, pointy-top)
//   - "hexish" grids     (Voronoi cells of blue-noise points: pentagons,
//                          hexagons, heptagons of similar size)
//
// The engine and all game variants only ever talk to TileMap — tiles, their
// neighbors, and their centers/polygons — so any generator that produces that
// structure can host any game.

import { SeededRandom, dist, dist2, clamp } from './util.js';

// d3-delaunay is loaded differently in Node (bare import) and in the browser
// (UMD bundle exposing window.d3, loaded by a <script> tag in index.html).
let Delaunay = (typeof window !== 'undefined' && window.d3 && window.d3.Delaunay) || null;
if (!Delaunay) {
  ({ Delaunay } = await import('d3-delaunay'));
}

const SQRT3 = Math.sqrt(3);

/**
 * Tile shape (all geometries):
 * { id: int, center: [x,y], polygon: [[x,y],...], neighbors: [ids],
 *   props: {}, axial?: {q,r} }
 *
 * props is the variant-owned bag: elevation, terrain, objective, etc.
 */
export class TileMap {
  constructor(tiles, kind, meta = {}) {
    this.tiles = tiles;            // dense array, tile.id === index
    this.kind = kind;              // 'hex' | 'hexish'
    this.meta = meta;              // generator info (seed, hexSize, ...)
    this.edgeProps = new Map();    // edgeKey -> {} (variant-owned, e.g. rivers)
    this._distCache = new Map();   // tileId -> Int32Array of hop distances
    if (kind === 'hex') {
      this._axialIndex = new Map();
      for (const t of tiles) this._axialIndex.set(`${t.axial.q},${t.axial.r}`, t.id);
    }
  }

  get size() { return this.tiles.length; }
  tile(id) { return this.tiles[id]; }
  neighbors(id) { return this.tiles[id].neighbors; }

  edgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  edgeProp(a, b) { return this.edgeProps.get(this.edgeKey(a, b)) || null; }
  setEdgeProp(a, b, props) {
    const key = this.edgeKey(a, b);
    this.edgeProps.set(key, { ...(this.edgeProps.get(key) || {}), ...props });
  }

  /** Every unordered adjacent pair [a, b] with a < b. */
  allEdges() {
    const out = [];
    for (const t of this.tiles) {
      for (const n of t.neighbors) if (t.id < n) out.push([t.id, n]);
    }
    return out;
  }

  /** Hop distance (pure tile count, ignoring terrain). Cached per source. */
  hopDistance(a, b) {
    return this.bfsFrom(a)[b];
  }

  bfsFrom(source) {
    let cached = this._distCache.get(source);
    if (cached) return cached;
    const d = new Int32Array(this.size).fill(-1);
    d[source] = 0;
    const queue = [source];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      for (const n of this.tiles[cur].neighbors) {
        if (d[n] === -1) { d[n] = d[cur] + 1; queue.push(n); }
      }
    }
    this._distCache.set(source, d);
    return d;
  }

  tilesWithinHops(source, hops) {
    const d = this.bfsFrom(source);
    const out = [];
    for (let i = 0; i < this.size; i++) {
      if (i !== source && d[i] !== -1 && d[i] <= hops) out.push(i);
    }
    return out;
  }

  /**
   * The shared border segment between two adjacent tiles, as [[x,y],[x,y]].
   * Used for drawing per-edge features (iso lines, rivers, cliffs).
   */
  sharedEdge(a, b) {
    const pa = this.tiles[a].polygon, pb = this.tiles[b].polygon;
    const eps2 = 1e-4;
    const shared = [];
    for (const p of pa) {
      for (const q of pb) {
        if (dist2(p, q) < eps2) { shared.push(p); break; }
      }
    }
    if (shared.length >= 2) {
      // pick the two farthest apart in case of duplicates
      let best = [shared[0], shared[1]], bestD = -1;
      for (let i = 0; i < shared.length; i++) {
        for (let j = i + 1; j < shared.length; j++) {
          const d = dist2(shared[i], shared[j]);
          if (d > bestD) { bestD = d; best = [shared[i], shared[j]]; }
        }
      }
      return best;
    }
    // Fallback (should not happen on well-formed maps): synthesize a short
    // segment perpendicular to the center-to-center line at its midpoint.
    const ca = this.tiles[a].center, cb = this.tiles[b].center;
    const mx = (ca[0] + cb[0]) / 2, my = (ca[1] + cb[1]) / 2;
    let nx = -(cb[1] - ca[1]), ny = cb[0] - ca[0];
    const len = Math.hypot(nx, ny) || 1;
    const h = dist(ca, cb) * 0.28;
    nx = nx / len * h; ny = ny / len * h;
    return [[mx - nx, my - ny], [mx + nx, my + ny]];
  }

  /** hex maps only: pixel point -> tile id (or -1). */
  tileAtPoint(x, y) {
    if (this.kind === 'hex') {
      const s = this.meta.hexSize;
      const qf = (SQRT3 / 3 * x - 1 / 3 * y) / s;
      const rf = (2 / 3 * y) / s;
      const { q, r } = axialRound(qf, rf);
      const id = this._axialIndex.get(`${q},${r}`);
      return id === undefined ? -1 : id;
    }
    // hexish: nearest center, rejected if the point is clearly off the map
    let best = -1, bestD = Infinity;
    for (const t of this.tiles) {
      const d = dist2(t.center, [x, y]);
      if (d < bestD) { bestD = d; best = t.id; }
    }
    const cellR = (this.meta.radius || 300) * 2.5 / Math.sqrt(this.size);
    return bestD > cellR * cellR * 4 ? -1 : best;
  }
}

// ---------------------------------------------------------------------------
// Regular hex grid (pointy-top axial)
// ---------------------------------------------------------------------------

export function axialToPixel(q, r, size) {
  return [size * SQRT3 * (q + r / 2), size * 1.5 * r];
}

function axialRound(qf, rf) {
  // cube rounding
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

const AXIAL_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

export function hexDistanceAxial(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

function hexCornersPointy(center, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i + Math.PI / 6; // pointy-top
    corners.push([
      // rounding keeps shared corners bit-identical between neighbors,
      // which sharedEdge() relies on
      Math.round((center[0] + size * Math.cos(angle)) * 1000) / 1000,
      Math.round((center[1] + size * Math.sin(angle)) * 1000) / 1000
    ]);
  }
  return corners;
}

/**
 * Hexagonal-shaped grid of regular hexagons, radius rings around the origin.
 * radius 5 -> 91 tiles, radius 6 -> 127 tiles.
 */
export function generateHexMap({ radius = 6, hexSize = 30 } = {}) {
  const coords = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      coords.push({ q, r });
    }
  }
  const index = new Map();
  coords.forEach((c, i) => index.set(`${c.q},${c.r}`, i));

  const tiles = coords.map((c, i) => {
    const center = axialToPixel(c.q, c.r, hexSize);
    return {
      id: i,
      axial: c,
      center,
      polygon: hexCornersPointy(center, hexSize),
      neighbors: [],
      props: {}
    };
  });
  for (const t of tiles) {
    for (const d of AXIAL_DIRS) {
      const n = index.get(`${t.axial.q + d.q},${t.axial.r + d.r}`);
      if (n !== undefined) t.neighbors.push(n);
    }
  }
  return new TileMap(tiles, 'hex', { radius, hexSize });
}

// ---------------------------------------------------------------------------
// Hexish grid (Voronoi over blue-noise points, optionally density-weighted)
// ---------------------------------------------------------------------------
//
// The pipeline is split into named steps (sample -> relax -> build) so the
// level editor can drive it interactively: hold the raw point list as the
// source of truth, mutate it (add/remove/drag/relax-brush), and rebuild the
// TileMap from scratch each edit via buildHexishFromPoints.

function voronoiBounds(radius) {
  return [-radius * 1.15, -radius * 1.15, radius * 1.15, radius * 1.15];
}

/** Shared Delaunay/Voronoi construction, reused by generation and editing. */
export function computeVoronoi(points, radius) {
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi(voronoiBounds(radius));
  return { delaunay, voronoi };
}

/**
 * Mitchell's best-candidate sampling with a density-scaled metric: where
 * density(x,y) is high, points may sit closer together, so the eventual
 * Voronoi cells come out smaller. Returns a raw point list (no topology).
 */
export function sampleBlueNoisePoints(rng, { tileCount = 120, radius = 300, density = null } = {}) {
  const dens = density || (() => 1);
  const points = [];
  const randInDisc = () => {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * radius;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const CANDIDATES = 24;
  points.push(randInDisc());
  while (points.length < tileCount) {
    let best = null, bestScore = -Infinity;
    for (let c = 0; c < CANDIDATES; c++) {
      const p = randInDisc();
      // scaled distance to nearest existing point: multiply by sqrt(density)
      // so dense regions accept nearer neighbors
      const w = Math.sqrt(Math.max(0.05, dens(p[0], p[1])));
      let nearest = Infinity;
      for (const q of points) {
        const d = dist2(p, q);
        if (d < nearest) nearest = d;
      }
      const score = nearest * w;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    points.push(best);
  }
  return points;
}

/** Damped Lloyd relaxation over the whole point set (keeps density gradients, evens shapes). */
export function dampedLloydRelax(points, radius, iterations = 2, damping = 0.35) {
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const { voronoi } = computeVoronoi(pts, radius);
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const cell = voronoi.cellPolygon(i);
      if (!cell) { next.push(pts[i]); continue; }
      let cx = 0, cy = 0;
      for (const [x, y] of cell) { cx += x; cy += y; }
      cx /= cell.length; cy /= cell.length;
      next.push([pts[i][0] + (cx - pts[i][0]) * damping, pts[i][1] + (cy - pts[i][1]) * damping]);
    }
    pts = next;
  }
  return pts;
}

/**
 * Relax only the points within `brushRadius` of `center`, one damped Lloyd
 * step each, computed against the Voronoi of the FULL point set (so a brush
 * stroke respects the cells of untouched neighbors). This is the "painting a
 * Lloyd relaxation brush" tool: dragging it over a chaotic patch of points
 * smooths their spacing toward regular hexagon-like cells.
 */
export function relaxPointsInRadius(points, center, brushRadius, radius, strength = 0.5) {
  const { voronoi } = computeVoronoi(points, radius);
  const out = points.map(p => [p[0], p[1]]);
  for (let i = 0; i < points.length; i++) {
    if (dist(points[i], center) > brushRadius) continue;
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of cell) { cx += x; cy += y; }
    cx /= cell.length; cy /= cell.length;
    out[i] = [points[i][0] + (cx - points[i][0]) * strength, points[i][1] + (cy - points[i][1]) * strength];
  }
  return out;
}

/** Adds a point unless it lands within minDist of an existing one. */
export function addPoint(points, p, minDist = 8) {
  for (const q of points) if (dist(p, q) < minDist) return points;
  return [...points, [p[0], p[1]]];
}

/** Removes the point nearest to p, if within maxDist. */
export function removeNearestPoint(points, p, maxDist = Infinity) {
  let bi = -1, bd = Infinity;
  points.forEach((q, i) => { const d = dist(p, q); if (d < bd) { bd = d; bi = i; } });
  if (bi === -1 || bd > maxDist) return points;
  return points.filter((_, i) => i !== bi);
}

/**
 * Builds a TileMap from an explicit point list: Voronoi cells clipped to a
 * circle of `radius`, keeping only the largest connected component. The
 * exact input point array is preserved (uncropped) on map.meta.points so
 * callers — the level editor in particular — can keep editing it and rebuild.
 */
export function buildHexishFromPoints(points, { radius = 300, seed = 1, tileCount } = {}) {
  const { voronoi } = computeVoronoi(points, radius);

  const keep = [];
  for (let i = 0; i < points.length; i++) {
    if (Math.hypot(points[i][0], points[i][1]) <= radius * 0.97) keep.push(i);
  }
  const idOf = new Map(); // voronoi index -> tile id
  keep.forEach((v, i) => idOf.set(v, i));

  const tiles = keep.map((v, i) => {
    const cell = voronoi.cellPolygon(v) || [];
    const polygon = cell.slice(0, cell.length - 1) // d3 repeats first point
      .map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    return { id: i, center: [points[v][0], points[v][1]], polygon, neighbors: [], props: {} };
  });
  keep.forEach((v, i) => {
    for (const n of voronoi.neighbors(v)) {
      if (idOf.has(n)) tiles[i].neighbors.push(idOf.get(n));
    }
  });

  // -- keep only the largest connected component ----------------------------
  const compOf = new Int32Array(tiles.length).fill(-1);
  let compCount = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (compOf[i] !== -1) continue;
    const queue = [i];
    compOf[i] = compCount;
    for (let h = 0; h < queue.length; h++) {
      for (const n of tiles[queue[h]].neighbors) {
        if (compOf[n] === -1) { compOf[n] = compCount; queue.push(n); }
      }
    }
    compCount++;
  }
  const sizes = new Array(compCount).fill(0);
  for (const c of compOf) sizes[c]++;
  const mainComp = sizes.indexOf(Math.max(...sizes));

  const finalIds = new Map();
  const finalTiles = [];
  tiles.forEach((t, i) => {
    if (compOf[i] === mainComp) {
      finalIds.set(i, finalTiles.length);
      finalTiles.push(t);
    }
  });
  finalTiles.forEach((t, i) => {
    t.id = i;
    t.neighbors = t.neighbors.filter(n => finalIds.has(n)).map(n => finalIds.get(n));
  });

  return new TileMap(finalTiles, 'hexish', {
    seed, radius, tileCount: tileCount ?? points.length,
    points: points.map(p => [p[0], p[1]])
  });
}

/**
 * Returns a TileMap of mostly 5/6/7-sided cells inside a circle of `radius`.
 * density(x, y) -> weight > 0; higher = smaller tiles there.
 */
export function generateHexishMap({
  tileCount = 120,
  radius = 300,
  seed = 1,
  density = null,
  relaxation = 2   // damped Lloyd iterations (cleans cell shapes)
} = {}) {
  const rng = new SeededRandom(seed);
  const points = sampleBlueNoisePoints(rng, { tileCount, radius, density });
  const relaxed = dampedLloydRelax(points, radius, relaxation);
  return buildHexishFromPoints(relaxed, { radius, seed, tileCount });
}
