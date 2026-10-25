// Natac: Blitz — deck-building WW2 conquest game mode engine
//
// A completely separate game mode, modelled on "The Quest for El Dorado" but
// reskinned as a WW2 conquest game. Instead of racing to a finish line, two
// players start at opposing HQs and try to capture each other's HQ.
//
// The El Dorado core is kept intact:
//   - each player has a personal deck, draws a hand (4 + depots held, max 6),
//     and keeps unplayed cards between turns;
//   - cards carry a TYPE and a VALUE. Played cards add their value to the
//     player's pool of that type for the turn:
//       rations -> movement points for infantry
//       fuel    -> movement points for armor, artillery and aircraft
//       ammo    -> spent to make attacks (any unit)
//       funds   -> spent in the shared market
//   - once per turn you may buy one card from the shared market. Funds pay
//     full value; any other card discarded for payment counts as 1/2.
//   - action cards draw extra cards or trash weak starters; single-use cards
//     (lend-lease, reinforcements, ...) leave the game once played.
//
// Combat is deterministic (no dice, like El Dorado): damage is derived from
// unit strength, a rock-paper-scissors matchup table, terrain and HP.
//
// The map is a graph of polygon tiles, so the same rules run on a regular hex
// grid ('hex') or an irregular pentagon/hexagon/heptagon Voronoi map ('poly').
// Both are generated point-symmetric about the centre so neither side gets a
// better board.
//
// Pure logic (no DOM): unit-tested under Node and imported by blitz.html.

import { SeededRandom } from '../core/utils.js';

// ---------------------------------------------------------------------------
// Constants & catalogues
// ---------------------------------------------------------------------------

export const BASE_HAND_SIZE = 4;
export const MAX_HAND_SIZE = 6;
export const AIR_RADIUS = 4;          // aircraft must end within this many tiles of a friendly airfield
export const AIR_OUT_OF_RANGE_DAMAGE = 4;
export const HEAL_AT_BASE = 2;
export const ROUND_LIMIT = 40;
export const DAMAGE_BASE = 4;         // damage dealt by an attacker of equal effective strength
export const COUNTER_BASE = 2.5;      // counter-fire is weaker than the initiating attack

export const POOL_TYPES = ['rations', 'fuel', 'ammo', 'funds'];

export const RESOURCES = {
  rations: { name: 'Rations', icon: '🥫', color: '#38a169' },
  fuel:    { name: 'Fuel',    icon: '⛽', color: '#d69e2e' },
  ammo:    { name: 'Ammo',    icon: '💥', color: '#c53030' },
  funds:   { name: 'Funds',   icon: '💰', color: '#2b6cb0' }
};

// Movement cost per tile entered, by movement class. Infinity = impassable.
export const TERRAIN = {
  plains:   { name: 'Plains',   color: '#c9d48c', cost: { foot: 1, tracks: 1, air: 1 } },
  forest:   { name: 'Forest',   color: '#5b8f4e', cost: { foot: 1, tracks: 2, air: 1 } },
  hills:    { name: 'Hills',    color: '#b39563', cost: { foot: 2, tracks: 2, air: 1 } },
  urban:    { name: 'Town',     color: '#d8cfc0', cost: { foot: 1, tracks: 2, air: 1 } },
  marsh:    { name: 'Marsh',    color: '#7fa392', cost: { foot: 2, tracks: 3, air: 1 } },
  mountain: { name: 'Mountain', color: '#6f6660', cost: { foot: 3, tracks: Infinity, air: 1 } },
  water:    { name: 'Water',    color: '#5b8ec2', cost: { foot: Infinity, tracks: Infinity, air: 1 } }
};

// Defensive bonus (fraction added to defence) by unit class and terrain.
// Infantry digs in well; armor is exposed everywhere but gets a little cover.
const DEFENSE_BONUS = {
  infantry:  { plains: 0, forest: 0.5, hills: 0.4, urban: 0.6, marsh: 0.1, mountain: 0.6, water: 0 },
  armor:     { plains: 0, forest: 0.1, hills: 0.2, urban: 0.1, marsh: 0,   mountain: 0,   water: 0 },
  artillery: { plains: 0, forest: 0.3, hills: 0.3, urban: 0.3, marsh: 0,   mountain: 0.3, water: 0 },
  air:       { plains: 0, forest: 0,   hills: 0,   urban: 0,   marsh: 0,   mountain: 0,   water: 0 }
};
export const HQ_DEFENSE_BONUS = 0.3;

// Attack multiplier for the attacker when the DEFENDER sits in this terrain.
// Tanks struggle in close terrain; aircraft struggle to spot targets in cover.
const TERRAIN_ATTACK_MOD = {
  armor: { forest: 0.6, urban: 0.6, marsh: 0.8 },
  air:   { forest: 0.7, urban: 0.8 }
};

// Attacker type -> defender type -> damage multiplier. 0 = cannot target.
export const MATCHUP = {
  infantry:  { infantry: 1.0, armor: 0.6, artillery: 1.3, air: 0.6 },
  armor:     { infantry: 1.4, armor: 1.0, artillery: 1.5, air: 0 },
  artillery: { infantry: 1.3, armor: 0.8, artillery: 1.0, air: 0 },
  air:       { infantry: 0.8, armor: 1.6, artillery: 1.5, air: 1.0 }
};

//   moveRes   : which pool pays for movement
//   moveClass : terrain cost column
//   maxMove   : max movement points one unit may spend per turn
//   minRange / range : attack distance in tiles
//   ammo      : ammo spent per attack
//   captures  : can take depots and the enemy HQ
export const UNIT_TYPES = {
  infantry: {
    key: 'infantry', name: 'Infantry', symbol: '🪖', hp: 10, atk: 4, def: 4,
    moveRes: 'rations', moveClass: 'foot', maxMove: 3, minRange: 1, range: 1, ammo: 1, captures: true,
    blurb: 'Cheap and stubborn. Digs in hard in forest, hills and towns; the only ground unit that can shoot at aircraft. Weak against armor in the open.'
  },
  armor: {
    key: 'armor', name: 'Armor', symbol: '🛡', hp: 12, atk: 6, def: 5,
    moveRes: 'fuel', moveClass: 'tracks', maxMove: 5, minRange: 1, range: 1, ammo: 1, captures: true,
    blurb: 'Fast and hard-hitting in open ground. Burns fuel, bogs down in forest, towns and marsh, cannot cross mountains, and is helpless against aircraft.'
  },
  artillery: {
    key: 'artillery', name: 'Artillery', symbol: '🎯', hp: 8, atk: 6, def: 2,
    moveRes: 'fuel', moveClass: 'tracks', maxMove: 2, minRange: 2, range: 3, ammo: 2, captures: false,
    blurb: 'Shells targets 2–3 tiles away without return fire. Cannot fire at adjacent units, defends poorly, and cannot capture.'
  },
  air: {
    key: 'air', name: 'Air Wing', symbol: '✈', hp: 8, atk: 5, def: 3,
    moveRes: 'fuel', moveClass: 'air', maxMove: 6, minRange: 1, range: 1, ammo: 1, captures: false,
    blurb: `Flies over any terrain and units. Devastating against armor and artillery, but must end within ${AIR_RADIUS} tiles of an airfield (your HQ or a held depot), cannot capture, and is shot at by infantry.`
  }
};

// Card catalogue. `starter` cards only exist in starting decks.
//   type   : pool type ('rations'|'fuel'|'ammo'|'funds'), 'wild' (choose one) or 'action'
//   effect : for action cards — { draw, trash } or { deploy: unitType }
export const CARDS = {
  rations1:  { key: 'rations1',  name: 'K-Rations',        type: 'rations', value: 1, cost: 0, starter: true },
  fuel1:     { key: 'fuel1',     name: 'Jerrycan',         type: 'fuel',    value: 1, cost: 0, starter: true },
  ammo1:     { key: 'ammo1',     name: 'Ammo Box',         type: 'ammo',    value: 1, cost: 0, starter: true },
  funds1:    { key: 'funds1',    name: 'Requisition',      type: 'funds',   value: 1, cost: 0, starter: true },

  rations2:  { key: 'rations2',  name: 'Field Kitchen',    type: 'rations', value: 2, cost: 2, stock: 3 },
  rations3:  { key: 'rations3',  name: 'Forced March',     type: 'rations', value: 3, cost: 3, stock: 3 },
  fuel2:     { key: 'fuel2',     name: 'Fuel Truck',       type: 'fuel',    value: 2, cost: 2, stock: 3 },
  fuel3:     { key: 'fuel3',     name: 'Fuel Convoy',      type: 'fuel',    value: 3, cost: 4, stock: 3 },
  fuel5:     { key: 'fuel5',     name: 'Captured Dump',    type: 'fuel',    value: 5, cost: 3, stock: 2, singleUse: true },
  ammo2:     { key: 'ammo2',     name: 'Ammo Truck',       type: 'ammo',    value: 2, cost: 2, stock: 3 },
  ammo3:     { key: 'ammo3',     name: 'Munitions Train',  type: 'ammo',    value: 3, cost: 4, stock: 3 },
  funds2:    { key: 'funds2',    name: 'War Bonds',        type: 'funds',   value: 2, cost: 2, stock: 3 },
  funds4:    { key: 'funds4',    name: 'Lend-Lease',       type: 'funds',   value: 4, cost: 3, stock: 2, singleUse: true },
  wild1:     { key: 'wild1',     name: 'Quartermaster',    type: 'wild',    value: 1, cost: 2, stock: 3 },
  wild2:     { key: 'wild2',     name: 'Logistics Corps',  type: 'wild',    value: 2, cost: 4, stock: 3 },
  recon:     { key: 'recon',     name: 'Recon Flight',     type: 'action',  cost: 4, stock: 3, effect: { draw: 2 } },
  staff:     { key: 'staff',     name: 'Staff Officer',    type: 'action',  cost: 4, stock: 3, effect: { draw: 1, trash: 1 } },
  purge:     { key: 'purge',     name: 'Reorganization',   type: 'action',  cost: 2, stock: 3, singleUse: true, effect: { trash: 2 } },
  reinfInf:  { key: 'reinfInf',  name: 'Infantry Division',type: 'action',  cost: 4, stock: 3, singleUse: true, effect: { deploy: 'infantry' } },
  reinfArm:  { key: 'reinfArm',  name: 'Armored Division', type: 'action',  cost: 6, stock: 2, singleUse: true, effect: { deploy: 'armor' } },
  reinfArt:  { key: 'reinfArt',  name: 'Artillery Battery',type: 'action',  cost: 5, stock: 2, singleUse: true, effect: { deploy: 'artillery' } },
  reinfAir:  { key: 'reinfAir',  name: 'Air Wing',         type: 'action',  cost: 6, stock: 2, singleUse: true, effect: { deploy: 'air' } }
};

export const STARTING_DECK = ['rations1', 'rations1', 'fuel1', 'fuel1', 'ammo1', 'ammo1', 'funds1', 'funds1'];
export const STARTING_ARMY = ['infantry', 'infantry', 'armor', 'artillery', 'air'];

const PLAYER_COLORS = ['#2b6cb0', '#c53030'];
const PLAYER_NAMES = ['Allies', 'Axis'];

export function cardDescription(key) {
  const c = CARDS[key];
  if (c.type in RESOURCES) return `+${c.value} ${RESOURCES[c.type].name}`;
  if (c.type === 'wild') return `+${c.value} of any one resource`;
  const e = c.effect;
  if (e.deploy) return `Deploy a new ${UNIT_TYPES[e.deploy].name} at your HQ`;
  const parts = [];
  if (e.draw) parts.push(`Draw ${e.draw}`);
  if (e.trash) parts.push(`trash up to ${e.trash} card${e.trash > 1 ? 's' : ''} from hand`);
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Map generation (hex grid or Voronoi polygons, point-symmetric)
// ---------------------------------------------------------------------------

const SQRT3 = Math.sqrt(3);

// Clip a polygon (with per-edge labels) to the half-plane n·x <= c. Edges cut
// by the clip line get `newLabel`, so after clipping every edge remembers
// which neighbouring site produced it.
function clipPolygon(verts, labels, n, c, newLabel) {
  const outV = [], outL = [];
  const inside = p => n[0] * p[0] + n[1] * p[1] <= c + 1e-9;
  const cut = (a, b) => {
    const da = n[0] * a[0] + n[1] * a[1] - c;
    const db = n[0] * b[0] + n[1] * b[1] - c;
    const t = da / (da - db);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const ia = inside(a), ib = inside(b);
    if (ia && ib) { outV.push(a); outL.push(labels[i]); }
    else if (ia && !ib) { outV.push(a); outL.push(labels[i]); outV.push(cut(a, b)); outL.push(newLabel); }
    else if (!ia && ib) { outV.push(cut(a, b)); outL.push(labels[i]); }
  }
  return { verts: outV, labels: outL };
}

// Voronoi cells of `points` inside the rectangle [-hw,hw]x[-hh,hh].
function voronoiCells(points, hw, hh, spacing) {
  const rect = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const reach2 = (3 * spacing) ** 2;
  return points.map((p, i) => {
    let cell = { verts: rect, labels: [-1, -1, -1, -1] };
    for (let j = 0; j < points.length; j++) {
      if (j === i) continue;
      const q = points[j];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      if (dx * dx + dy * dy > reach2) continue;
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      cell = clipPolygon(cell.verts, cell.labels, [dx, dy], dx * m[0] + dy * m[1], j);
    }
    const neighbors = new Set();
    for (let k = 0; k < cell.verts.length; k++) {
      const lab = cell.labels[k];
      if (lab < 0) continue;
      const a = cell.verts[k], b = cell.verts[(k + 1) % cell.verts.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > spacing * 0.05) neighbors.add(lab);
    }
    return { poly: cell.verts, neighbors: [...neighbors] };
  });
}

// Smooth pseudo-noise: a sum of random plane waves. Point-symmetry is applied
// afterwards by copying terrain to mirror tiles, so this need not be symmetric.
function makeNoise(rng, scale) {
  const waves = [];
  for (let i = 0; i < 6; i++) {
    const ang = rng.next() * Math.PI * 2;
    const freq = (0.6 + rng.next() * 1.4) / scale;
    waves.push({ kx: Math.cos(ang) * freq, ky: Math.sin(ang) * freq, ph: rng.next() * Math.PI * 2, amp: 1 / (i + 1) });
  }
  const norm = waves.reduce((s, w) => s + w.amp, 0);
  return (x, y) => waves.reduce((s, w) => s + w.amp * Math.sin(w.kx * x + w.ky * y + w.ph), 0) / norm;
}

export function generateMap({ mapType = 'hex', seed = 1, cols = 15, rows = 9 } = {}) {
  const rng = new SeededRandom(seed);
  const s = 1;                                  // lattice spacing (centre-to-centre)
  const hw = (cols - 1) / 2 * s;
  const hh = (rows - 1) / 2 * s * SQRT3 / 2;
  const R = Math.ceil(rows / 2) + 1;
  const Q = Math.ceil(cols / 2) + R;

  // Collect lattice sites. Each site is paired with its point reflection so
  // jitter can be mirrored and the board stays symmetric.
  const sites = [];
  const index = new Map();
  for (let r = -R; r <= R; r++) {
    for (let q = -Q; q <= Q; q++) {
      const x = s * (q + r / 2), y = s * SQRT3 / 2 * r;
      if (Math.abs(x) > hw + 1e-9 || Math.abs(y) > hh + 1e-9) continue;
      index.set(`${q},${r}`, sites.length);
      sites.push({ q, r, x, y });
    }
  }
  const mirrorOf = sites.map(st => index.get(`${-st.q},${-st.r}`));
  const canonical = i => {
    const st = sites[i];
    return st.r > 0 || (st.r === 0 && st.q > 0);
  };

  let cells;
  if (mapType === 'poly') {
    const pts = sites.map(st => [st.x, st.y]);
    for (let i = 0; i < sites.length; i++) {
      if (!canonical(i)) continue;
      const ang = rng.next() * Math.PI * 2, rad = rng.next() * 0.33 * s;
      const jx = Math.cos(ang) * rad, jy = Math.sin(ang) * rad;
      pts[i] = [sites[i].x + jx, sites[i].y + jy];
      pts[mirrorOf[i]] = [-pts[i][0], -pts[i][1]];
    }
    // Keep the jittered points inside the board.
    for (const p of pts) { p[0] = Math.max(-hw, Math.min(hw, p[0])); p[1] = Math.max(-hh, Math.min(hh, p[1])); }
    const pad = s * 0.5;
    const vc = voronoiCells(pts, hw + pad, hh + pad, s);
    // Make adjacency symmetric (numerical slivers can drop one side).
    vc.forEach((c, i) => c.neighbors.forEach(j => { if (!vc[j].neighbors.includes(i)) vc[j].neighbors.push(i); }));
    cells = pts.map((p, i) => ({ center: p, poly: vc[i].poly, neighbors: vc[i].neighbors }));
  } else {
    const rad = s / SQRT3;
    cells = sites.map(st => {
      const poly = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3;
        poly.push([st.x + rad * Math.cos(a), st.y + rad * Math.sin(a)]);
      }
      const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]
        .map(([dq, dr]) => index.get(`${st.q + dq},${st.r + dr}`))
        .filter(n => n !== undefined);
      return { center: [st.x, st.y], poly, neighbors };
    });
  }

  const tiles = cells.map((c, i) => ({
    id: i, center: c.center, poly: c.poly, neighbors: c.neighbors,
    mirror: mirrorOf[i], terrain: 'plains', depot: false, hq: null, owner: null
  }));
  return { tiles, width: 2 * hw, height: 2 * hh, mapType, seed };
}

// Tile-hop distance matrix (BFS from every tile).
function allPairsDistance(tiles) {
  return tiles.map(t => {
    const d = new Array(tiles.length).fill(Infinity);
    d[t.id] = 0;
    const queue = [t.id];
    for (let h = 0; h < queue.length; h++) {
      const cur = queue[h];
      for (const n of tiles[cur].neighbors) {
        if (d[n] === Infinity) { d[n] = d[cur] + 1; queue.push(n); }
      }
    }
    return d;
  });
}

function nearestTile(tiles, x, y, filter = () => true) {
  let best = null, bd = Infinity;
  for (const t of tiles) {
    if (!filter(t)) continue;
    const d = (t.center[0] - x) ** 2 + (t.center[1] - y) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// Cheapest path cost between two tiles for a movement class (ignoring units).
function terrainPathCost(tiles, from, to, moveClass) {
  const dist = new Array(tiles.length).fill(Infinity);
  dist[from] = 0;
  const open = [from];
  while (open.length) {
    open.sort((a, b) => dist[a] - dist[b]);
    const cur = open.shift();
    if (cur === to) return dist[cur];
    for (const n of tiles[cur].neighbors) {
      const c = dist[cur] + TERRAIN[tiles[n].terrain].cost[moveClass];
      if (c < dist[n]) { if (dist[n] === Infinity) open.push(n); dist[n] = c; }
    }
  }
  return Infinity;
}

function assignTerrain(map, rng) {
  const { tiles } = map;
  const elev = makeNoise(rng, 3.2);
  const moist = makeNoise(rng, 2.4);
  for (const t of tiles) {
    if (t.mirror < t.id) continue; // assigned from its mirror
    const [x, y] = t.center;
    const e = elev(x, y), m = moist(x, y);
    let terrain = 'plains';
    if (e > 0.55) terrain = 'mountain';
    else if (e > 0.32) terrain = 'hills';
    else if (e < -0.6) terrain = 'water';
    else if (e < -0.4 && m > 0.1) terrain = 'marsh';
    else if (m > 0.3) terrain = 'forest';
    else if (rng.next() < 0.05) terrain = 'urban'; // scattered villages
    t.terrain = terrain;
    tiles[t.mirror].terrain = terrain;
  }

  const setPair = (t, fields) => { Object.assign(t, fields); Object.assign(tiles[t.mirror], fields); };

  // HQs at the far west / east, cleared surroundings.
  const hq0 = nearestTile(tiles, -map.width / 2 + 0.5, 0);
  const hq1 = tiles[hq0.mirror];
  hq0.hq = 0; hq0.owner = 0; hq1.hq = 1; hq1.owner = 1;
  for (const hq of [hq0, hq1]) {
    hq.terrain = 'urban';
    for (const n of hq.neighbors) if (tiles[n].terrain === 'water' || tiles[n].terrain === 'mountain') tiles[n].terrain = 'plains';
  }

  // Five neutral supply depots: two mirrored pairs plus the centre.
  const depotSpots = [[-map.width / 4, map.height / 4], [-map.width / 4, -map.height / 4], [0, 0]];
  for (const [x, y] of depotSpots) {
    const t = nearestTile(tiles, x, y, t => t.hq === null && !t.depot && tiles[t.mirror].hq === null);
    setPair(t, { depot: true, terrain: 'urban' });
  }
  return { hq0, hq1 };
}

// Build a playable map: retry terrain until both HQs and every depot are
// reachable by infantry and armor.
export function buildBoard({ mapType = 'hex', seed = 1, cols, rows } = {}) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const map = generateMap({ mapType, seed, cols, rows });
    const rng = new SeededRandom(seed * 7919 + attempt * 104729 + 17);
    const { hq0, hq1 } = assignTerrain(map, rng);
    const goals = [hq1, ...map.tiles.filter(t => t.depot)];
    const ok = goals.every(g =>
      terrainPathCost(map.tiles, hq0.id, g.id, 'tracks') < Infinity &&
      terrainPathCost(map.tiles, hq0.id, g.id, 'foot') < Infinity);
    if (ok || attempt === 29) {
      if (!ok) for (const t of map.tiles) if (t.terrain === 'water' || t.terrain === 'mountain') t.terrain = 'hills';
      map.hqs = [hq0.id, hq1.id];
      return map;
    }
  }
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function createGame({ mapType = 'hex', seed = Date.now() % 1e9, players = [{}, {}], cols, rows } = {}) {
  const map = buildBoard({ mapType, seed, cols, rows });
  const state = {
    mapType, seed,
    tiles: map.tiles,
    width: map.width, height: map.height,
    dist: allPairsDistance(map.tiles),
    players: [],
    units: [],
    market: {},
    current: 0,
    round: 1,
    winner: null,
    winReason: null,
    log: [],
    nextId: 1,
    rngState: (seed * 2654435761) % 4294967296
  };
  for (const [key, c] of Object.entries(CARDS)) if (!c.starter) state.market[key] = c.stock;

  for (let i = 0; i < 2; i++) {
    const cfg = players[i] || {};
    const p = {
      id: i,
      name: cfg.name || PLAYER_NAMES[i],
      ai: !!cfg.ai,
      color: PLAYER_COLORS[i],
      hq: map.hqs[i],
      deck: [], hand: [], discard: [], played: [],
      pools: { rations: 0, fuel: 0, ammo: 0, funds: 0 },
      bought: false
    };
    p.deck = shuffle(state, STARTING_DECK.map(key => newCard(state, key)));
    state.players.push(p);
    for (const type of STARTING_ARMY) {
      const tile = deployTile(state, i, type);
      spawnUnit(state, i, type, tile);
    }
    drawUpTo(state, p, handSize(state, i));
  }
  addLog(state, `Round 1 — ${state.players[0].name} to move.`);
  return state;
}

function newCard(state, key) { return { id: state.nextId++, key }; }

// Deterministic RNG whose state lives in the (serialisable) game state.
function rand(state) {
  const r = new SeededRandom(state.rngState);
  const v = r.next();
  state.rngState = r.seed;
  return v;
}

function shuffle(state, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addLog(state, msg) { state.log.push(msg); }

export function spawnUnit(state, owner, type, tileId) {
  const T = UNIT_TYPES[type];
  const u = { id: state.nextId++, type, owner, tile: tileId, hp: T.hp, moved: 0, attacked: false };
  state.units.push(u);
  return u;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const currentPlayer = state => state.players[state.current];
export const unitById = (state, id) => state.units.find(u => u.id === id);
export const unitAt = (state, tileId) => state.units.find(u => u.tile === tileId);
export const distance = (state, a, b) => state.dist[a][b];

export function depotsHeld(state, playerId) {
  return state.tiles.filter(t => t.depot && t.owner === playerId).length;
}

export function handSize(state, playerId) {
  return Math.min(MAX_HAND_SIZE, BASE_HAND_SIZE + depotsHeld(state, playerId));
}

export function airfields(state, playerId) {
  return state.tiles.filter(t => t.owner === playerId && (t.depot || t.hq === playerId)).map(t => t.id);
}

export function withinAirRange(state, playerId, tileId) {
  return airfields(state, playerId).some(a => state.dist[a][tileId] <= AIR_RADIUS);
}

// First free tile at or around the player's HQ (BFS outward) usable by `type`.
export function deployTile(state, playerId, type) {
  const hq = state.players[playerId]?.hq ?? state.tiles.find(t => t.hq === playerId).id;
  const T = UNIT_TYPES[type];
  const order = state.tiles.map(t => t.id)
    .filter(id => state.dist[hq][id] <= 2)
    .sort((a, b) => state.dist[hq][a] - state.dist[hq][b] || a - b);
  for (const id of order) {
    if (unitAt(state, id)) continue;
    if (TERRAIN[state.tiles[id].terrain].cost[T.moveClass] === Infinity) continue;
    return id;
  }
  return null;
}

// Tiles a unit can move to this turn, with the movement cost of getting there.
// Ground units pass through friends but not enemies; aircraft overfly anything.
export function reachableTiles(state, unitId) {
  const u = unitById(state, unitId);
  const result = new Map();
  if (!u || u.owner !== state.current || u.attacked || state.winner !== null) return result;
  const T = UNIT_TYPES[u.type];
  const p = state.players[u.owner];
  const budget = Math.min(p.pools[T.moveRes], T.maxMove - u.moved);
  if (budget <= 0) return result;

  const cost = new Map([[u.tile, 0]]);
  const open = [u.tile];
  while (open.length) {
    open.sort((a, b) => cost.get(a) - cost.get(b));
    const cur = open.shift();
    for (const n of state.tiles[cur].neighbors) {
      const step = TERRAIN[state.tiles[n].terrain].cost[T.moveClass];
      const c = cost.get(cur) + step;
      if (c > budget) continue;
      const occ = unitAt(state, n);
      if (occ && occ.owner !== u.owner && T.moveClass !== 'air') continue;
      if (!cost.has(n) || c < cost.get(n)) {
        if (!cost.has(n)) open.push(n);
        cost.set(n, c);
      }
    }
  }
  for (const [id, c] of cost) {
    if (id === u.tile || unitAt(state, id)) continue;
    if (T.moveClass === 'air') {
      if (state.tiles[id].terrain === 'water') continue;
      if (!withinAirRange(state, u.owner, id)) continue;
    }
    if (state.tiles[id].hq !== null && state.tiles[id].hq !== u.owner && !T.captures) continue;
    result.set(id, c);
  }
  return result;
}

function canTarget(state, attacker, defender) {
  const A = UNIT_TYPES[attacker.type];
  if (!MATCHUP[attacker.type][defender.type]) return false;
  const d = state.dist[attacker.tile][defender.tile];
  return d >= A.minRange && d <= A.range;
}

export function attackTargets(state, unitId) {
  const u = unitById(state, unitId);
  if (!u || u.owner !== state.current || u.attacked || state.winner !== null) return [];
  if (state.players[u.owner].pools.ammo < UNIT_TYPES[u.type].ammo) return [];
  return state.units.filter(e => e.owner !== u.owner && canTarget(state, u, e)).map(e => e.id);
}

function hpScale(u) { return 0.5 + 0.5 * u.hp / UNIT_TYPES[u.type].hp; }

function defenseValue(state, u) {
  const tile = state.tiles[u.tile];
  let bonus = DEFENSE_BONUS[u.type][tile.terrain] || 0;
  if (tile.hq === u.owner && u.type !== 'air') bonus += HQ_DEFENSE_BONUS;
  return UNIT_TYPES[u.type].def * (1 + bonus) * hpScale(u);
}

function attackValue(state, attacker, defender) {
  const terrain = state.tiles[defender.tile].terrain;
  const tmod = TERRAIN_ATTACK_MOD[attacker.type]?.[terrain] ?? 1;
  return UNIT_TYPES[attacker.type].atk * MATCHUP[attacker.type][defender.type] * tmod * hpScale(attacker);
}

// Deterministic combat outcome. Counter-fire happens only if the defender
// survives and can itself target the attacker at this distance.
export function previewAttack(state, attackerId, defenderId) {
  const a = unitById(state, attackerId), d = unitById(state, defenderId);
  const damage = Math.max(1, Math.round(DAMAGE_BASE * attackValue(state, a, d) / defenseValue(state, d)));
  const defHpAfter = Math.max(0, d.hp - damage);
  let counter = 0;
  if (defHpAfter > 0 && canTarget(state, d, a)) {
    const hurt = { ...d, hp: defHpAfter };
    counter = Math.max(1, Math.round(COUNTER_BASE * attackValue(state, hurt, a) / defenseValue(state, a)));
  }
  return { damage, counter, kills: defHpAfter === 0, dies: counter >= a.hp };
}

// Cheapest way to pay `cost` from the funds pool plus hand cards. Funds and
// wild cards pay full value, everything else half. Returns card ids or null.
export function autoPayment(state, playerId, cost) {
  const p = state.players[playerId];
  let need = cost - p.pools.funds;
  if (need <= 0) return [];
  const worth = c => {
    const C = CARDS[c.key];
    return C.type === 'funds' || C.type === 'wild' ? C.value : 0.5;
  };
  // Prefer spending the cheapest / least useful cards first.
  const cands = [...p.hand].sort((x, y) =>
    (CARDS[x.key].cost - CARDS[y.key].cost) || (worth(y) - worth(x)));
  const pay = [];
  for (const c of cands) {
    if (need <= 0) break;
    pay.push(c.id);
    need -= worth(c);
  }
  return need <= 0 ? pay : null;
}

export function paymentValue(state, playerId, cardIds) {
  const p = state.players[playerId];
  return cardIds.reduce((s, id) => {
    const c = p.hand.find(h => h.id === id);
    if (!c) return s;
    const C = CARDS[c.key];
    return s + (C.type === 'funds' || C.type === 'wild' ? C.value : 0.5);
  }, p.pools.funds);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
//
//   { type: 'playCard', cardId, as?: poolType, trash?: [cardId] }
//   { type: 'move', unitId, tileId }
//   { type: 'attack', unitId, targetId }
//   { type: 'buy', key, payWith?: [cardId] }
//   { type: 'discard', cardIds: [cardId] }
//   { type: 'endTurn' }

export function validateAction(state, action) {
  if (state.winner !== null) return { ok: false, reason: 'Game over' };
  const p = currentPlayer(state);
  switch (action.type) {
    case 'playCard': {
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card) return { ok: false, reason: 'Card not in hand' };
      const C = CARDS[card.key];
      if (C.type === 'wild' && !POOL_TYPES.includes(action.as)) return { ok: false, reason: 'Choose a resource for the wild card' };
      if (C.effect?.trash) {
        const t = action.trash || [];
        if (t.length > C.effect.trash) return { ok: false, reason: `Trash at most ${C.effect.trash}` };
        if (t.some(id => id === card.id || !p.hand.find(c => c.id === id))) return { ok: false, reason: 'Can only trash other cards in hand' };
      }
      if (C.effect?.deploy && deployTile(state, p.id, C.effect.deploy) === null) return { ok: false, reason: 'No free tile at your HQ' };
      return { ok: true };
    }
    case 'move': {
      const u = unitById(state, action.unitId);
      if (!u || u.owner !== p.id) return { ok: false, reason: 'Not your unit' };
      if (u.attacked) return { ok: false, reason: 'Unit has already attacked this turn' };
      if (!reachableTiles(state, u.id).has(action.tileId)) {
        return { ok: false, reason: `Not enough ${RESOURCES[UNIT_TYPES[u.type].moveRes].name.toLowerCase()} or out of range` };
      }
      return { ok: true };
    }
    case 'attack': {
      const u = unitById(state, action.unitId);
      const t = unitById(state, action.targetId);
      if (!u || u.owner !== p.id) return { ok: false, reason: 'Not your unit' };
      if (!t || t.owner === p.id) return { ok: false, reason: 'Invalid target' };
      if (u.attacked) return { ok: false, reason: 'Unit has already attacked this turn' };
      if (p.pools.ammo < UNIT_TYPES[u.type].ammo) return { ok: false, reason: `Needs ${UNIT_TYPES[u.type].ammo} ammo` };
      if (!canTarget(state, u, t)) return { ok: false, reason: `${UNIT_TYPES[u.type].name} cannot hit that target` };
      return { ok: true };
    }
    case 'buy': {
      const C = CARDS[action.key];
      if (!C || C.starter) return { ok: false, reason: 'Unknown card' };
      if (p.bought) return { ok: false, reason: 'Already bought a card this turn' };
      if (!state.market[action.key]) return { ok: false, reason: 'Sold out' };
      const pay = action.payWith || [];
      if (pay.some(id => !p.hand.find(c => c.id === id))) return { ok: false, reason: 'Payment card not in hand' };
      if (paymentValue(state, p.id, pay) < C.cost) return { ok: false, reason: `Costs ${C.cost} funds` };
      return { ok: true };
    }
    case 'discard': {
      if ((action.cardIds || []).some(id => !p.hand.find(c => c.id === id))) return { ok: false, reason: 'Card not in hand' };
      return { ok: true };
    }
    case 'endTurn':
      return { ok: true };
    default:
      return { ok: false, reason: `Unknown action ${action.type}` };
  }
}

export function applyAction(state, action) {
  const v = validateAction(state, action);
  if (!v.ok) throw new Error(v.reason);
  const p = currentPlayer(state);
  switch (action.type) {
    case 'playCard': playCard(state, p, action); break;
    case 'move': moveUnit(state, p, action); break;
    case 'attack': resolveAttack(state, p, action); break;
    case 'buy': buyCard(state, p, action); break;
    case 'discard':
      for (const id of action.cardIds) p.discard.push(takeFromHand(p, id));
      break;
    case 'endTurn': endTurn(state); break;
  }
  return state;
}

function takeFromHand(p, id) {
  const i = p.hand.findIndex(c => c.id === id);
  return p.hand.splice(i, 1)[0];
}

function draw(state, p, n) {
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      if (!p.discard.length) return;
      p.deck = shuffle(state, p.discard);
      p.discard = [];
    }
    p.hand.push(p.deck.pop());
  }
}

function drawUpTo(state, p, n) { draw(state, p, Math.max(0, n - p.hand.length)); }

function playCard(state, p, { cardId, as, trash = [] }) {
  const card = takeFromHand(p, cardId);
  const C = CARDS[card.key];
  if (C.type in RESOURCES) {
    p.pools[C.type] += C.value;
  } else if (C.type === 'wild') {
    p.pools[as] += C.value;
  } else {
    const e = C.effect;
    for (const id of trash) takeFromHand(p, id); // trashed cards leave the game
    if (e.draw) draw(state, p, e.draw);
    if (e.deploy) {
      const tile = deployTile(state, p.id, e.deploy);
      spawnUnit(state, p.id, e.deploy, tile);
      addLog(state, `${p.name} deploys a new ${UNIT_TYPES[e.deploy].name}.`);
    }
    if (trash.length) addLog(state, `${p.name} trashes ${trash.length} card${trash.length > 1 ? 's' : ''}.`);
  }
  if (!C.singleUse) p.played.push(card);
}

function moveUnit(state, p, { unitId, tileId }) {
  const u = unitById(state, unitId);
  const T = UNIT_TYPES[u.type];
  const c = reachableTiles(state, unitId).get(tileId);
  p.pools[T.moveRes] -= c;
  u.moved += c;
  u.tile = tileId;
  const tile = state.tiles[tileId];
  if (T.captures) {
    if (tile.hq !== null && tile.hq !== p.id) {
      state.winner = p.id;
      state.winReason = `${p.name} captured the enemy HQ!`;
      addLog(state, state.winReason);
      return;
    }
    if (tile.depot && tile.owner !== p.id) {
      tile.owner = p.id;
      addLog(state, `${p.name} captures a supply depot.`);
    }
  }
}

function resolveAttack(state, p, { unitId, targetId }) {
  const a = unitById(state, unitId), d = unitById(state, targetId);
  const res = previewAttack(state, unitId, targetId);
  p.pools.ammo -= UNIT_TYPES[a.type].ammo;
  a.attacked = true;
  d.hp -= res.damage;
  a.hp -= res.counter;
  const an = UNIT_TYPES[a.type].name, dn = UNIT_TYPES[d.type].name;
  addLog(state, `${p.name} ${an} hits ${dn} for ${res.damage}` + (res.counter ? `, takes ${res.counter} back` : '') + '.');
  state.units = state.units.filter(u => {
    if (u.hp > 0) return true;
    addLog(state, `${state.players[u.owner].name} ${UNIT_TYPES[u.type].name} destroyed.`);
    return false;
  });
  checkElimination(state);
}

function checkElimination(state) {
  for (const pl of state.players) {
    if (!state.units.some(u => u.owner === pl.id)) {
      const other = state.players[1 - pl.id];
      state.winner = other.id;
      state.winReason = `${other.name} destroyed every enemy unit!`;
      addLog(state, state.winReason);
      return;
    }
  }
}

function buyCard(state, p, { key, payWith = [] }) {
  for (const id of payWith) p.played.push(takeFromHand(p, id));
  p.pools.funds = 0;
  p.bought = true;
  state.market[key]--;
  p.discard.push(newCard(state, key));
  addLog(state, `${p.name} buys ${CARDS[key].name}.`);
}

function endTurn(state) {
  const p = currentPlayer(state);
  // Aircraft stranded away from an airfield run out of fuel.
  for (const u of state.units) {
    if (u.owner === p.id && u.type === 'air' && !withinAirRange(state, p.id, u.tile)) {
      u.hp -= AIR_OUT_OF_RANGE_DAMAGE;
      addLog(state, `${p.name} Air Wing is out of range of an airfield and loses ${AIR_OUT_OF_RANGE_DAMAGE} HP.`);
    }
  }
  state.units = state.units.filter(u => u.hp > 0);
  checkElimination(state);

  p.discard.push(...p.played);
  p.played = [];
  p.pools = { rations: 0, fuel: 0, ammo: 0, funds: 0 };
  p.bought = false;
  drawUpTo(state, p, handSize(state, p.id));
  if (state.winner !== null) return;

  state.current = 1 - state.current;
  if (state.current === 0) state.round++;
  if (state.round > ROUND_LIMIT) {
    finishOnPoints(state);
    return;
  }
  startTurn(state);
}

function startTurn(state) {
  const p = currentPlayer(state);
  for (const u of state.units) {
    if (u.owner !== p.id) continue;
    u.moved = 0;
    u.attacked = false;
    const t = state.tiles[u.tile];
    if (t.owner === p.id && (t.depot || t.hq === p.id)) u.hp = Math.min(UNIT_TYPES[u.type].hp, u.hp + HEAL_AT_BASE);
  }
  addLog(state, `Round ${state.round} — ${p.name} to move.`);
}

// Round limit reached: most depots wins, then most total unit HP.
function finishOnPoints(state) {
  const score = pl => [depotsHeld(state, pl.id), state.units.filter(u => u.owner === pl.id).reduce((s, u) => s + u.hp, 0)];
  const [a, b] = state.players.map(score);
  const winner = a[0] !== b[0] ? (a[0] > b[0] ? 0 : 1) : a[1] !== b[1] ? (a[1] > b[1] ? 0 : 1) : null;
  state.winner = winner === null ? -1 : winner;
  state.winReason = winner === null
    ? `Round limit reached — stalemate.`
    : `Round limit reached — ${state.players[winner].name} wins on depots held / army strength.`;
  addLog(state, state.winReason);
}
