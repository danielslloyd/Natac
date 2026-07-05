// Natac — Combat game mode engine
//
// A completely separate game mode from the Catan settlement game. It is a
// Civ-V-inspired hex-tactics game with a supply-line layer bolted on top.
//
// Three combat eras escalate the logistics burden:
//   - classical   : units need FOOD (consumed every turn)
//   - napoleonic  : units need FOOD + AMMO (ammo spent on combat)
//   - ww2         : units need FOOD + AMMO + FUEL (fuel spent on movement),
//                   and adds AIR units that operate from distinct bases.
//
// Every resource a unit needs is delivered along a supply line that traces
// back to one of the owning player's cities. Supply lines have a length-based
// cost: the farther a unit sits from its nearest supplying city, the more of
// each resource it takes to keep it fed / fuelled / stocked. Units that fall
// out of supply range starve (attrition) and fight at half strength.
//
// The module is pure logic (no DOM) so it can be unit-tested under Node and
// imported directly by combat.html in the browser.

import { SeededRandom, hexNeighbors, hexDistance, hexSpiral, hexRing } from '../core/utils.js';

// ---------------------------------------------------------------------------
// Constants & configuration
// ---------------------------------------------------------------------------

// Each extra hex of supply distance adds this fraction to the resource cost of
// keeping a unit supplied. distance 0 -> x1.0, distance 4 -> x2.0.
export const SUPPLY_COST_PER_HEX = 0.25;

// Attrition (HP loss) suffered by a unit that cannot be supplied with food.
export const STARVATION_DAMAGE = 12;

// Strength multiplier applied to a unit that is out of supply.
export const UNSUPPLIED_COMBAT_PENALTY = 0.5;

export const MAX_HP = 100;

export const TERRAIN = {
  plains:    { name: 'Plains',    land: true,  moveCost: 1, defense: 0.0,  color: '#c8d38a' },
  forest:    { name: 'Forest',    land: true,  moveCost: 2, defense: 0.25, color: '#4f8f4a' },
  hills:     { name: 'Hills',     land: true,  moveCost: 2, defense: 0.25, color: '#b08d57' },
  mountains: { name: 'Mountains', land: false, moveCost: Infinity, defense: 0.0, color: '#8a8a8a' },
  water:     { name: 'Water',     land: false, moveCost: 1, defense: 0.0,  color: '#4a7fb0' }
};

// Era definitions. `order` also drives the setup screen ordering.
export const ERAS = {
  classical: {
    id: 'classical', order: 0, name: 'Classical',
    blurb: 'Legions and archers. Armies march on their stomachs — units need FOOD only.',
    usesFood: true, usesAmmo: false, usesFuel: false, hasAir: false,
    maxSupplyRange: 4,
    units: ['warrior', 'spearman', 'archer', 'catapult', 'galley']
  },
  napoleonic: {
    id: 'napoleonic', order: 1, name: 'Napoleonic',
    blurb: 'Muskets and cannon. Powder matters — units need FOOD and AMMUNITION.',
    usesFood: true, usesAmmo: true, usesFuel: false, hasAir: false,
    maxSupplyRange: 6,
    units: ['line_infantry', 'cavalry', 'cannon', 'frigate']
  },
  ww2: {
    id: 'ww2', order: 2, name: 'World War II',
    blurb: 'Tanks, ships and aircraft. Everything runs dry — units need FOOD, AMMO and FUEL.',
    usesFood: true, usesAmmo: true, usesFuel: true, hasAir: true,
    maxSupplyRange: 8,
    units: ['infantry', 'tank', 'artillery', 'destroyer', 'fighter', 'bomber']
  }
};

// Unit catalog. `domain` is 'land' | 'sea' | 'air'.
//   strength        : melee attack / defense strength
//   rangedStrength   : ranged attack strength (0 = melee-only)
//   range            : max ranged attack distance in hexes (air = distance from base)
//   moves            : movement points per turn (air units rebase instead)
//   foodCost         : food consumed per turn
//   ammoCost         : ammo consumed per attack
//   fuelCost         : fuel consumed per hex of movement (air: per sortie)
//   prod             : production points needed to recruit
export const UNIT_TYPES = {
  // --- Classical -----------------------------------------------------------
  warrior:  { key: 'warrior',  name: 'Warrior',  domain: 'land', symbol: '⚔', strength: 20, rangedStrength: 0,  range: 0, moves: 2, foodCost: 1, ammoCost: 0, fuelCost: 0, prod: 3 },
  spearman: { key: 'spearman', name: 'Spearman', domain: 'land', symbol: '🛡', strength: 25, rangedStrength: 0,  range: 0, moves: 2, foodCost: 1, ammoCost: 0, fuelCost: 0, prod: 4 },
  archer:   { key: 'archer',   name: 'Archer',   domain: 'land', symbol: '🏹', strength: 15, rangedStrength: 20, range: 2, moves: 2, foodCost: 1, ammoCost: 0, fuelCost: 0, prod: 4 },
  catapult: { key: 'catapult', name: 'Catapult', domain: 'land', symbol: '☄', strength: 10, rangedStrength: 28, range: 2, moves: 1, foodCost: 2, ammoCost: 0, fuelCost: 0, prod: 6, siege: true },
  galley:   { key: 'galley',   name: 'Galley',   domain: 'sea',  symbol: '⛵', strength: 18, rangedStrength: 22, range: 2, moves: 3, foodCost: 2, ammoCost: 0, fuelCost: 0, prod: 5 },

  // --- Napoleonic ----------------------------------------------------------
  line_infantry: { key: 'line_infantry', name: 'Line Infantry', domain: 'land', symbol: '🎖', strength: 35, rangedStrength: 30, range: 1, moves: 2, foodCost: 1, ammoCost: 1, fuelCost: 0, prod: 5 },
  cavalry:       { key: 'cavalry',       name: 'Cavalry',       domain: 'land', symbol: '🐎', strength: 42, rangedStrength: 0,  range: 0, moves: 4, foodCost: 2, ammoCost: 1, fuelCost: 0, prod: 6 },
  cannon:        { key: 'cannon',        name: 'Cannon',        domain: 'land', symbol: '💥', strength: 22, rangedStrength: 46, range: 2, moves: 1, foodCost: 2, ammoCost: 2, fuelCost: 0, prod: 7, siege: true },
  frigate:       { key: 'frigate',       name: 'Frigate',       domain: 'sea',  symbol: '🚢', strength: 40, rangedStrength: 45, range: 2, moves: 4, foodCost: 2, ammoCost: 2, fuelCost: 0, prod: 7 },

  // --- WW2 -----------------------------------------------------------------
  infantry:  { key: 'infantry',  name: 'Infantry',  domain: 'land', symbol: '🪖', strength: 50, rangedStrength: 45, range: 1, moves: 2, foodCost: 1, ammoCost: 1, fuelCost: 1, prod: 5 },
  tank:      { key: 'tank',      name: 'Tank',      domain: 'land', symbol: '🛞', strength: 72, rangedStrength: 0,  range: 0, moves: 4, foodCost: 2, ammoCost: 2, fuelCost: 2, prod: 8 },
  artillery: { key: 'artillery', name: 'Artillery', domain: 'land', symbol: '🎯', strength: 30, rangedStrength: 70, range: 3, moves: 2, foodCost: 2, ammoCost: 3, fuelCost: 1, prod: 8, siege: true },
  destroyer: { key: 'destroyer', name: 'Destroyer', domain: 'sea',  symbol: '🚢', strength: 60, rangedStrength: 55, range: 2, moves: 5, foodCost: 2, ammoCost: 2, fuelCost: 1, prod: 8 },
  fighter:   { key: 'fighter',   name: 'Fighter',   domain: 'air',  symbol: '✈', strength: 60, rangedStrength: 60, range: 5, moves: 0, foodCost: 2, ammoCost: 2, fuelCost: 2, prod: 8, rebaseRange: 6 },
  bomber:    { key: 'bomber',    name: 'Bomber',    domain: 'air',  symbol: '🛩', strength: 30, rangedStrength: 85, range: 8, moves: 0, foodCost: 3, ammoCost: 3, fuelCost: 3, prod: 10, rebaseRange: 6 }
};

const PLAYER_COLORS = ['#2b6cb0', '#c53030', '#2f855a', '#6b46c1', '#b7791f', '#319795'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const tileKey = (q, r) => `${q},${r}`;

let _idCounter = 0;
function nextId(prefix) { return `${prefix}${++_idCounter}`; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function getTile(state, q, r) { return state.tiles.get(tileKey(q, r)); }

export function unitById(state, id) { return state.units.find(u => u.id === id); }

export function playerById(state, id) { return state.players.find(p => p.id === id); }

// Field units are land/sea units that physically occupy a tile (air units sit
// at a base and do not block ground movement).
export function fieldUnitAt(state, q, r) {
  const k = tileKey(q, r);
  return state.units.find(u => u.domain !== 'air' && u.alive && tileKey(u.q, u.r) === k);
}

export function unitsAt(state, q, r) {
  const k = tileKey(q, r);
  return state.units.filter(u => u.alive && tileKey(u.q, u.r) === k);
}

// ---------------------------------------------------------------------------
// Map generation
// ---------------------------------------------------------------------------

function generateTerrain(rng) {
  const roll = rng.next();
  if (roll < 0.10) return 'mountains';
  if (roll < 0.32) return 'forest';
  if (roll < 0.52) return 'hills';
  return 'plains';
}

function buildMap(state) {
  const { rng, radius } = state;
  const coords = hexSpiral({ q: 0, r: 0 }, radius);

  // Seed a couple of "seas" so water forms coherent bodies rather than noise.
  const seaCenters = [
    { q: -Math.floor(radius / 2), r: Math.floor(radius / 2) },
    { q: Math.floor(radius / 2), r: -Math.floor(radius / 2) }
  ];

  for (const c of coords) {
    let terrain;
    const nearSea = seaCenters.some(s => hexDistance(s, c) <= 1 + Math.floor(rng.next() * 2));
    if (nearSea && rng.next() < 0.75) {
      terrain = 'water';
    } else {
      terrain = generateTerrain(rng);
    }
    state.tiles.set(tileKey(c.q, c.r), {
      q: c.q, r: c.r, key: tileKey(c.q, c.r),
      terrain,
      city: null
    });
  }

  // Capitals: spread evenly around the outer ring so they sit on real grid
  // tiles (the ring is part of the spiral) and start far apart.
  const perimeter = hexRing({ q: 0, r: 0 }, radius);
  const step = Math.floor(perimeter.length / state.players.length);

  state.players.forEach((player, idx) => {
    const spot = perimeter[(idx * step) % perimeter.length];
    const tile = ensureLandTile(state, spot);
    tile.terrain = 'plains';
    tile.city = {
      owner: player.id, isCapital: true, hp: MAX_HP, maxHp: MAX_HP,
      defenseStrength: 40, name: `${player.name}'s Capital`
    };
    player.capitalKey = tile.key;
    // Carve a functional home region: a capital must be able to deploy units
    // and project supply, so guarantee enough passable land neighbours.
    clearCapitalSurroundings(state, tile);
  });

  // A few neutral cities to fight over — capturing them extends supply reach.
  const neutralCount = Math.max(2, Math.floor(radius / 2));
  let placed = 0, guard = 0;
  while (placed < neutralCount && guard++ < 200) {
    const c = coords[rng.nextInt(0, coords.length - 1)];
    const tile = state.tiles.get(tileKey(c.q, c.r));
    if (!tile || tile.city || !TERRAIN[tile.terrain].land) continue;
    // Keep neutral cities away from capitals.
    const tooClose = state.players.some(p => {
      const cap = state.tiles.get(p.capitalKey);
      return cap && hexDistance(cap, tile) < 3;
    });
    if (tooClose) continue;
    tile.city = {
      owner: null, isCapital: false, hp: MAX_HP, maxHp: MAX_HP,
      defenseStrength: 25, name: 'Free City'
    };
    placed++;
  }
}

// Make a capital viable: mountains next to it become passable hills, and we
// ensure at least three land neighbours so supply can flow and units can
// deploy. Water is preserved where possible so coastal capitals keep a port.
function clearCapitalSurroundings(state, capTile) {
  const neigh = hexNeighbors(capTile)
    .map(n => state.tiles.get(tileKey(n.q, n.r)))
    .filter(Boolean);
  // Mountains beside a capital are always softened to hills.
  for (const t of neigh) if (t.terrain === 'mountains') t.terrain = 'hills';
  const landCount = () => neigh.filter(t => TERRAIN[t.terrain].land).length;
  // Convert water neighbours to plains until we have three land exits.
  for (const t of neigh) {
    if (landCount() >= 3) break;
    if (t.terrain === 'water') t.terrain = 'plains';
  }
}

function ensureLandTile(state, coord) {
  let tile = state.tiles.get(tileKey(coord.q, coord.r));
  if (!tile) {
    tile = { q: coord.q, r: coord.r, key: tileKey(coord.q, coord.r), terrain: 'plains', city: null };
    state.tiles.set(tile.key, tile);
  }
  if (!TERRAIN[tile.terrain].land) tile.terrain = 'plains';
  return tile;
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function createCombatGame(options = {}) {
  const {
    era = 'classical',
    playerNames = ['You', 'Enemy'],
    aiPlayers = [1],
    radius = 5,
    seed = Date.now()
  } = options;

  if (!ERAS[era]) throw new Error(`Unknown era: ${era}`);

  const rng = new SeededRandom(seed);
  const aiSet = new Set(aiPlayers);

  const state = {
    era,
    eraConfig: ERAS[era],
    seed,
    rng,
    radius,
    tiles: new Map(),
    units: [],
    players: playerNames.map((name, idx) => ({
      id: nextId('p'),
      idx,
      name,
      color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
      isAI: aiSet.has(idx),
      capitalKey: null,
      // Starting stockpile — generous enough to field an opening army.
      resources: { food: 30, ammo: 20, fuel: 20, production: 12 }
    })),
    currentPlayerIdx: 0,
    turn: 1,
    log: [],
    winner: null
  };

  buildMap(state);
  giveStartingUnits(state);
  // Prime supply status for the opening player.
  refreshSupply(state, state.players[0].id);
  return state;
}

function giveStartingUnits(state) {
  const era = state.eraConfig;
  // A sensible opening garrison for each era, spawned around each capital.
  const opening = {
    classical: ['warrior', 'warrior', 'archer'],
    napoleonic: ['line_infantry', 'line_infantry', 'cannon'],
    ww2: ['infantry', 'infantry', 'tank']
  }[era.id];

  for (const player of state.players) {
    const cap = state.tiles.get(player.capitalKey);
    const ring = [cap, ...hexNeighbors(cap).map(n => state.tiles.get(tileKey(n.q, n.r)))];
    let placedAt = 0;
    for (const typeKey of opening) {
      // Find a free, domain-appropriate tile near the capital.
      let target = null;
      for (let i = placedAt; i < ring.length; i++) {
        const t = ring[i];
        if (!t) continue;
        if (!TERRAIN[t.terrain].land) continue;
        if (fieldUnitAt(state, t.q, t.r)) continue;
        target = t; placedAt = i + 1; break;
      }
      if (!target) target = cap;
      spawnUnit(state, player.id, typeKey, target.key);
    }
  }
}

export function spawnUnit(state, ownerId, typeKey, atKey) {
  const type = UNIT_TYPES[typeKey];
  const tile = state.tiles.get(atKey);
  const unit = {
    id: nextId('u'),
    owner: ownerId,
    type: typeKey,
    domain: type.domain,
    q: tile.q, r: tile.r,
    hp: MAX_HP,
    movesLeft: type.moves,
    hasAttacked: false,
    fortified: false,
    alive: true,
    // Air units track a home base tile they fly from.
    baseKey: type.domain === 'air' ? atKey : null,
    supply: { inSupply: true, distance: 0, source: atKey },
    starving: false
  };
  state.units.push(unit);
  return unit;
}

// ---------------------------------------------------------------------------
// Supply lines
// ---------------------------------------------------------------------------

// BFS distance map from a player's supply sources, across tiles that supply can
// legally flow through for the given movement domain. Enemy field units block
// supply (they sever the line). Returns Map<tileKey, distanceInHexes>.
export function supplyDistanceMap(state, playerId, domain) {
  const dist = new Map();
  const queue = [];

  // Cities owned by the player are supply sources at distance 0. For sea supply
  // a city must be coastal (adjacent to water) to project onto the sea.
  for (const tile of state.tiles.values()) {
    if (!tile.city || tile.city.owner !== playerId) continue;
    if (domain === 'sea') {
      const coastal = hexNeighbors(tile).some(n => {
        const nt = state.tiles.get(tileKey(n.q, n.r));
        return nt && nt.terrain === 'water';
      });
      if (!coastal) continue;
    }
    dist.set(tile.key, 0);
    queue.push(tile);
  }

  const passable = (tile) => {
    if (!tile) return false;
    if (domain === 'sea') return tile.terrain === 'water';
    // land supply flows over land tiles (not water, not mountains)
    return TERRAIN[tile.terrain].land;
  };

  const blockedByEnemy = (tile) => {
    const occ = fieldUnitAt(state, tile.q, tile.r);
    return occ && occ.owner !== playerId;
  };

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(cur.key);
    for (const n of hexNeighbors(cur)) {
      const nt = state.tiles.get(tileKey(n.q, n.r));
      if (!nt || dist.has(nt.key)) continue;
      // A source city itself may not be passable terrain for the domain (e.g.
      // an inland capital projecting sea supply), so we only gate the *steps*.
      if (!passable(nt)) continue;
      if (blockedByEnemy(nt)) continue; // enemy unit cuts the supply line here
      dist.set(nt.key, d + 1);
      queue.push(nt);
    }
  }
  return dist;
}

// Recompute supply status for every unit belonging to a player.
export function refreshSupply(state, playerId) {
  const maps = {
    land: supplyDistanceMap(state, playerId, 'land'),
    sea: supplyDistanceMap(state, playerId, 'sea')
  };
  const range = state.eraConfig.maxSupplyRange;

  for (const unit of state.units) {
    if (unit.owner !== playerId || !unit.alive) continue;
    if (unit.domain === 'air') {
      // Air units are supplied directly by their home base (a friendly city).
      const base = state.tiles.get(unit.baseKey);
      const ok = base && base.city && base.city.owner === playerId;
      unit.supply = { inSupply: !!ok, distance: 0, source: ok ? unit.baseKey : null };
      continue;
    }
    const map = maps[unit.domain] || maps.land;
    const d = map.get(tileKey(unit.q, unit.r));
    if (d === undefined || d > range) {
      unit.supply = { inSupply: false, distance: d === undefined ? Infinity : d, source: null };
    } else {
      unit.supply = { inSupply: true, distance: d, source: 'net' };
    }
  }
}

// Cost multiplier applied to a unit's resource draw based on supply distance.
export function supplyMultiplier(unit) {
  if (!unit.supply.inSupply) return Infinity;
  return 1 + unit.supply.distance * SUPPLY_COST_PER_HEX;
}

// ---------------------------------------------------------------------------
// Upkeep — runs at the start of a player's turn
// ---------------------------------------------------------------------------

export function runUpkeep(state, playerId) {
  const player = playerById(state, playerId);
  const era = state.eraConfig;
  const events = [];

  // 1. Cities produce resources.
  let cityCount = 0;
  for (const tile of state.tiles.values()) {
    if (tile.city && tile.city.owner === playerId) {
      cityCount++;
      const mult = tile.city.isCapital ? 2 : 1;
      player.resources.production += 3 * mult;
      if (era.usesFood) player.resources.food += 6 * mult;
      if (era.usesAmmo) player.resources.ammo += 4 * mult;
      if (era.usesFuel) player.resources.fuel += 4 * mult;
      // Cities slowly repair — but not while an enemy unit besieges them.
      const besieged = hexNeighbors(tile).some(n => {
        const occ = fieldUnitAt(state, n.q, n.r);
        return occ && occ.owner !== playerId;
      });
      if (!besieged && tile.city.hp < tile.city.maxHp) {
        tile.city.hp = Math.min(tile.city.maxHp, tile.city.hp + 10);
      }
    }
  }

  // 2. Refresh supply, then pay food upkeep along supply lines.
  refreshSupply(state, playerId);

  const myUnits = state.units.filter(u => u.owner === playerId && u.alive);
  // Feed the cheapest (closest) units first so shortages bite the far-flung ones.
  const fed = myUnits.slice().sort((a, b) => (a.supply.distance) - (b.supply.distance));

  for (const unit of fed) {
    unit.starving = false;
    const type = UNIT_TYPES[unit.type];
    if (!era.usesFood || type.foodCost === 0) { unit.movesLeft = type.moves; unit.hasAttacked = false; continue; }

    const need = Math.ceil(type.foodCost * (unit.supply.inSupply ? supplyMultiplier(unit) : 0));
    if (unit.supply.inSupply && player.resources.food >= need) {
      player.resources.food -= need;
    } else {
      // Out of supply, or the stockpile ran dry: the unit starves.
      unit.starving = true;
      unit.hp = clamp(unit.hp - STARVATION_DAMAGE, 1, MAX_HP);
      events.push(`${type.name} is out of supply and suffers attrition (-${STARVATION_DAMAGE} HP).`);
    }
    unit.movesLeft = type.moves;
    unit.hasAttacked = false;
  }

  return { cityCount, events };
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function domainCanEnter(state, unit, tile) {
  if (!tile) return false;
  const t = TERRAIN[tile.terrain];
  if (unit.domain === 'land') return t.land;
  if (unit.domain === 'sea') return tile.terrain === 'water';
  return false; // air units do not move across tiles
}

// Dijkstra over movement points from a unit's tile, respecting terrain cost,
// domain and enemy blocking. Returns Map<tileKey, {cost, from}>.
export function reachableTiles(state, unit) {
  const result = new Map();
  if (unit.domain === 'air' || unit.movesLeft <= 0) return result;
  const start = tileKey(unit.q, unit.r);
  result.set(start, { cost: 0, from: null });

  // Simple Dijkstra; grids are small so a resort-each-step frontier is fine.
  const frontier = [{ key: start, cost: 0 }];
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift();
    if (cur.cost > result.get(cur.key).cost) continue;
    const [cq, cr] = cur.key.split(',').map(Number);
    for (const n of hexNeighbors({ q: cq, r: cr })) {
      const nt = state.tiles.get(tileKey(n.q, n.r));
      if (!nt) continue;
      if (!domainCanEnter(state, unit, nt)) continue;
      const occupant = fieldUnitAt(state, nt.q, nt.r);
      if (occupant) continue; // cannot move *through* or onto occupied tiles (attack instead)
      if (nt.city && nt.city.owner !== unit.owner) continue; // enemy/neutral cities must be captured via attack/advance, not walked onto
      const step = TERRAIN[nt.terrain].moveCost;
      const newCost = cur.cost + step;
      if (newCost > unit.movesLeft) continue;
      const existing = result.get(nt.key);
      if (!existing || newCost < existing.cost) {
        result.set(nt.key, { cost: newCost, from: cur.key });
        frontier.push({ key: nt.key, cost: newCost });
      }
    }
  }
  result.delete(start);
  return result;
}

export function canMove(state, unit, toKey) {
  if (unit.owner !== state.players[state.currentPlayerIdx].id) return { ok: false, reason: 'Not your turn' };
  if (!unit.alive) return { ok: false, reason: 'Unit destroyed' };
  if (unit.domain === 'air') return { ok: false, reason: 'Air units rebase instead of moving' };
  const reach = reachableTiles(state, unit);
  const dest = reach.get(toKey);
  if (!dest) return { ok: false, reason: 'Out of range' };

  // In WW2, movement burns fuel scaled by supply distance.
  if (state.eraConfig.usesFuel) {
    const fuel = fuelForMove(state, unit, dest.cost);
    if (!unit.supply.inSupply) return { ok: false, reason: 'Out of supply — no fuel can reach this unit' };
    const player = playerById(state, unit.owner);
    if (player.resources.fuel < fuel) return { ok: false, reason: `Not enough fuel (need ${fuel})` };
  }
  return { ok: true, cost: dest.cost };
}

function fuelForMove(state, unit, moveCost) {
  const type = UNIT_TYPES[unit.type];
  return Math.ceil(type.fuelCost * moveCost * supplyMultiplier(unit));
}

export function moveUnit(state, unitId, toKey) {
  const unit = unitById(state, unitId);
  if (!unit) return { ok: false, reason: 'No such unit' };
  const check = canMove(state, unit, toKey);
  if (!check.ok) return check;

  if (state.eraConfig.usesFuel) {
    const player = playerById(state, unit.owner);
    player.resources.fuel -= fuelForMove(state, unit, check.cost);
  }

  const dest = state.tiles.get(toKey);
  unit.q = dest.q; unit.r = dest.r;
  unit.movesLeft -= check.cost;
  unit.fortified = false;

  // Moving onto a friendly / undefended neutral(after fight) city keeps things
  // simple: neutral cities are captured via attack->advance, so here we only
  // recompute supply (the unit may have re-entered or left the network).
  refreshSupply(state, unit.owner);
  return { ok: true };
}

export function fortifyUnit(state, unitId) {
  const unit = unitById(state, unitId);
  if (!unit || unit.owner !== state.players[state.currentPlayerIdx].id) return { ok: false, reason: 'Not your unit' };
  unit.fortified = true;
  unit.movesLeft = 0;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

// Effective combat strength including HP, terrain, fortification and supply.
export function effectiveStrength(state, unit, { ranged = false, defending = false } = {}) {
  const type = UNIT_TYPES[unit.type];
  let base = ranged ? type.rangedStrength : type.strength;
  if (base === 0) base = type.strength;
  // Wounded units fight weaker (Civ-style): from x0.5 at 1 HP to x1.0 at full.
  let s = base * (0.5 + 0.5 * (unit.hp / MAX_HP));
  if (defending) {
    const tile = getTile(state, unit.q, unit.r);
    if (tile) s *= 1 + TERRAIN[tile.terrain].defense;
    if (unit.fortified) s *= 1.3;
    if (tile && tile.city && tile.city.owner === unit.owner) s *= 1.25; // garrison bonus
  }
  if (!unit.supply.inSupply) s *= UNSUPPLIED_COMBAT_PENALTY;
  return Math.max(1, s);
}

function damageFormula(attackerStr, defenderStr, rng) {
  const ratio = attackerStr / defenderStr;
  const randomFactor = 0.75 + rng.next() * 0.5; // 0.75 .. 1.25
  return clamp(Math.round(30 * Math.pow(ratio, 1.5) * randomFactor), 1, MAX_HP);
}

// What can this unit attack right now?
export function attackableTargets(state, unit) {
  const targets = [];
  if (!unit.alive || unit.hasAttacked) return targets;
  const type = UNIT_TYPES[unit.type];
  const isRanged = type.rangedStrength > 0 && type.range > 0;
  const reach = unit.domain === 'air' ? type.range : (isRanged ? type.range : 1);
  const origin = unit.domain === 'air' ? state.tiles.get(unit.baseKey) : unit;
  if (!origin) return targets;

  for (const tile of state.tiles.values()) {
    const d = hexDistance(origin, tile);
    if (d === 0 || d > reach) continue;
    const enemyUnit = state.units.find(u => u.alive && u.owner !== unit.owner &&
      u.domain !== 'air' && tileKey(u.q, u.r) === tile.key);
    const enemyCity = tile.city && tile.city.owner !== unit.owner && tile.city.owner !== null ? tile.city : null;
    const neutralCity = tile.city && tile.city.owner === null ? tile.city : null;
    if (enemyUnit) {
      targets.push({ tileKey: tile.key, kind: 'unit', unitId: enemyUnit.id, distance: d });
    } else if (enemyCity || neutralCity) {
      targets.push({ tileKey: tile.key, kind: 'city', distance: d });
    }
  }
  return targets;
}

export function canAttack(state, unit, targetKey) {
  if (unit.owner !== state.players[state.currentPlayerIdx].id) return { ok: false, reason: 'Not your turn' };
  if (unit.hasAttacked) return { ok: false, reason: 'Already attacked this turn' };
  const target = attackableTargets(state, unit).find(t => t.tileKey === targetKey);
  if (!target) return { ok: false, reason: 'No valid target there' };

  // Ammo is required for combat in Napoleonic and WW2.
  if (state.eraConfig.usesAmmo) {
    if (!unit.supply.inSupply) return { ok: false, reason: 'Out of supply — no ammunition' };
    const type = UNIT_TYPES[unit.type];
    const ammo = Math.ceil(type.ammoCost * supplyMultiplier(unit));
    const player = playerById(state, unit.owner);
    if (player.resources.ammo < ammo) return { ok: false, reason: `Not enough ammunition (need ${ammo})` };
  }
  return { ok: true, target };
}

export function attack(state, attackerId, targetKey) {
  const attacker = unitById(state, attackerId);
  if (!attacker) return { ok: false, reason: 'No such unit' };
  const check = canAttack(state, attacker, targetKey);
  if (!check.ok) return check;
  const type = UNIT_TYPES[attacker.type];
  const log = [];

  // Spend ammunition (scaled by supply distance) up front.
  if (state.eraConfig.usesAmmo) {
    const ammo = Math.ceil(type.ammoCost * supplyMultiplier(attacker));
    playerById(state, attacker.owner).resources.ammo -= ammo;
  }
  attacker.hasAttacked = true;
  attacker.fortified = false;

  const target = check.target;
  const isRanged = attacker.domain === 'air' || (type.rangedStrength > 0 && type.range > 0);

  if (target.kind === 'unit') {
    const defender = unitById(state, target.unitId);
    const atkStr = effectiveStrength(state, attacker, { ranged: isRanged });
    const defStr = effectiveStrength(state, defender, { defending: true });
    const dmgToDef = damageFormula(atkStr, defStr, state.rng);
    defender.hp -= dmgToDef;
    log.push(`${UNIT_TYPES[attacker.type].name} hits ${UNIT_TYPES[defender.type].name} for ${dmgToDef}.`);

    // Melee (and air-vs-air dogfights) take return fire.
    const dogfight = attacker.domain === 'air' && defender.domain === 'air';
    if ((!isRanged || dogfight) && defender.hp > 0) {
      const retStr = effectiveStrength(state, defender, { defending: true });
      const dmgToAtk = damageFormula(retStr, atkStr, state.rng);
      attacker.hp -= dmgToAtk;
      log.push(`${UNIT_TYPES[defender.type].name} returns fire for ${dmgToAtk}.`);
    }

    if (defender.hp <= 0) { defender.alive = false; log.push(`${UNIT_TYPES[defender.type].name} destroyed.`); }
    if (attacker.hp <= 0) { attacker.alive = false; log.push(`${UNIT_TYPES[attacker.type].name} destroyed.`); }

    // Melee land/sea attacker advances into a vacated tile.
    if (!isRanged && attacker.alive && !defender.alive) {
      const destTile = getTile(state, defender.q, defender.r);
      if (domainCanEnter(state, attacker, destTile) && !fieldUnitAt(state, destTile.q, destTile.r)) {
        attacker.q = destTile.q; attacker.r = destTile.r;
        maybeCaptureCity(state, attacker, destTile, log);
      }
    }
  } else {
    // City bombardment / assault.
    const tile = state.tiles.get(target.tileKey);
    const city = tile.city;
    const atkStr = effectiveStrength(state, attacker, { ranged: isRanged });
    const cityStr = city.defenseStrength * (0.5 + 0.5 * (city.hp / city.maxHp));
    const dmg = damageFormula(atkStr, cityStr, state.rng);
    city.hp = Math.max(0, city.hp - dmg);
    log.push(`${UNIT_TYPES[attacker.type].name} bombards ${city.name} for ${dmg}. (City HP ${city.hp})`);

    // Melee land unit adjacent to a broken city captures it by advancing in.
    if (!isRanged && attacker.domain === 'land' && city.hp <= 0 && hexDistance(attacker, tile) === 1) {
      if (!fieldUnitAt(state, tile.q, tile.r)) {
        attacker.q = tile.q; attacker.r = tile.r;
        maybeCaptureCity(state, attacker, tile, log);
      }
    } else if (city.hp > 0 && !isRanged) {
      // The city shoots back at melee attackers.
      const ret = damageFormula(cityStr, atkStr, state.rng);
      attacker.hp -= ret;
      log.push(`${city.name} fires back for ${ret}.`);
      if (attacker.hp <= 0) { attacker.alive = false; log.push(`${UNIT_TYPES[attacker.type].name} destroyed.`); }
    }
  }

  cleanupDead(state);
  refreshSupply(state, attacker.owner);
  const winner = checkWinner(state);
  state.log.push(...log);
  return { ok: true, log, winner };
}

function maybeCaptureCity(state, unit, tile, log) {
  if (!tile.city) return;
  const prevOwner = tile.city.owner;
  tile.city.owner = unit.owner;
  tile.city.hp = Math.floor(tile.city.maxHp * 0.5);
  tile.city.isCapital = tile.city.isCapital; // capital stays a capital, now owned by conqueror
  log.push(`${playerById(state, unit.owner).name} captures ${tile.city.name}!`);
  // Recompute supply for both sides — the network just changed hands.
  refreshSupply(state, unit.owner);
  if (prevOwner) refreshSupply(state, prevOwner);
}

function cleanupDead(state) {
  state.units = state.units.filter(u => u.alive);
}

// ---------------------------------------------------------------------------
// Air unit rebasing
// ---------------------------------------------------------------------------

export function rebaseTargets(state, unit) {
  if (unit.domain !== 'air') return [];
  const type = UNIT_TYPES[unit.type];
  const base = state.tiles.get(unit.baseKey);
  const out = [];
  for (const tile of state.tiles.values()) {
    if (!tile.city || tile.city.owner !== unit.owner) continue;
    if (tile.key === unit.baseKey) continue;
    if (hexDistance(base, tile) <= type.rebaseRange) out.push(tile.key);
  }
  return out;
}

export function rebaseAir(state, unitId, cityKey) {
  const unit = unitById(state, unitId);
  if (!unit || unit.domain !== 'air') return { ok: false, reason: 'Not an air unit' };
  if (unit.hasAttacked) return { ok: false, reason: 'Already acted this turn' };
  if (!rebaseTargets(state, unit).includes(cityKey)) return { ok: false, reason: 'Out of rebase range or not a friendly city' };
  unit.baseKey = cityKey;
  const t = state.tiles.get(cityKey);
  unit.q = t.q; unit.r = t.r;
  unit.hasAttacked = true; // rebasing uses the unit's action for the turn
  refreshSupply(state, unit.owner);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recruiting units
// ---------------------------------------------------------------------------

export function recruitableTypes(state) {
  return state.eraConfig.units.map(k => UNIT_TYPES[k]);
}

// How far from a city fresh reinforcements may muster.
const RECRUIT_RADIUS = 2;

// Tiles where a player may place a freshly built unit of the given type.
export function recruitTiles(state, playerId, typeKey) {
  const type = UNIT_TYPES[typeKey];
  const out = [];
  const cities = [...state.tiles.values()].filter(t => t.city && t.city.owner === playerId);
  if (type.domain === 'air') {
    // Air units are simply based at any friendly city.
    return cities.map(c => c.key);
  }
  // Land/sea units deploy onto a free, domain-appropriate tile within a short
  // muster radius of a friendly city (immediate ring first, then one further
  // out) so a crowded capital can still reinforce.
  for (const tile of state.tiles.values()) {
    const domainOk = type.domain === 'sea' ? tile.terrain === 'water' : TERRAIN[tile.terrain].land;
    if (!domainOk) continue;
    if (fieldUnitAt(state, tile.q, tile.r)) continue;
    if (tile.city && tile.city.owner !== null && tile.city.owner !== playerId) continue;
    const nearCity = cities.some(c => hexDistance(c, tile) <= RECRUIT_RADIUS);
    if (nearCity && !out.includes(tile.key)) out.push(tile.key);
  }
  return out;
}

export function canRecruit(state, playerId, typeKey, atKey) {
  const player = playerById(state, playerId);
  if (player.id !== state.players[state.currentPlayerIdx].id) return { ok: false, reason: 'Not your turn' };
  const type = UNIT_TYPES[typeKey];
  if (!type || !state.eraConfig.units.includes(typeKey)) return { ok: false, reason: 'Not available this era' };
  if (player.resources.production < type.prod) return { ok: false, reason: `Need ${type.prod} production` };
  if (!recruitTiles(state, playerId, typeKey).includes(atKey)) return { ok: false, reason: 'Cannot deploy there' };
  return { ok: true };
}

export function recruit(state, playerId, typeKey, atKey) {
  const check = canRecruit(state, playerId, typeKey, atKey);
  if (!check.ok) return check;
  const player = playerById(state, playerId);
  const type = UNIT_TYPES[typeKey];
  player.resources.production -= type.prod;
  const unit = spawnUnit(state, playerId, typeKey, atKey);
  unit.movesLeft = 0;       // freshly built units cannot move the turn they appear
  unit.hasAttacked = true;
  refreshSupply(state, playerId);
  return { ok: true, unit };
}

// ---------------------------------------------------------------------------
// Turn flow & win condition
// ---------------------------------------------------------------------------

export function endTurn(state) {
  state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
  if (state.currentPlayerIdx === 0) state.turn++;
  const player = state.players[state.currentPlayerIdx];
  const upkeep = runUpkeep(state, player.id);
  if (upkeep.events.length) state.log.push(...upkeep.events);
  return { player, upkeep, winner: checkWinner(state) };
}

// A player is eliminated when they hold no capital. Last capital-holder wins.
export function checkWinner(state) {
  if (state.winner) return state.winner;
  const alive = state.players.filter(p => {
    for (const tile of state.tiles.values()) {
      if (tile.city && tile.city.isCapital && tile.city.owner === p.id) return true;
    }
    return false;
  });
  if (alive.length === 1) { state.winner = alive[0].id; return state.winner; }
  return null;
}

// ---------------------------------------------------------------------------
// Basic AI
// ---------------------------------------------------------------------------

// Runs a full turn for an AI player and returns a log of what it did. The AI
// is intentionally simple: it attacks when it can, otherwise advances toward
// the nearest enemy while trying to stay supplied, and reinforces at home.
export function runAITurn(state, playerId) {
  const log = [];
  const player = playerById(state, playerId);

  // 1. Reinforce if affordable and a slot exists.
  const buildable = recruitableTypes(state)
    .filter(t => t.prod <= player.resources.production && t.domain !== 'air')
    .sort((a, b) => b.prod - a.prod);
  for (const type of buildable) {
    const tiles = recruitTiles(state, playerId, type.key);
    if (tiles.length && player.resources.production >= type.prod) {
      const res = recruit(state, playerId, type.key, tiles[0]);
      if (res.ok) { log.push(`${player.name} builds a ${type.name}.`); break; }
    }
  }

  refreshSupply(state, playerId);
  const enemies = () => state.units.filter(u => u.alive && u.owner !== playerId && u.domain !== 'air');

  // 2. Act with each unit: attack if possible, else advance toward the enemy.
  for (const unit of state.units.filter(u => u.owner === playerId && u.alive)) {
    if (state.winner) break;

    // Attack the weakest reachable target.
    let acted = false;
    const targets = attackableTargets(state, unit)
      .filter(t => canAttack(state, unit, t.tileKey).ok);
    if (targets.length) {
      targets.sort((a, b) => a.distance - b.distance);
      const res = attack(state, unit.id, targets[0].tileKey);
      if (res.ok) { log.push(...res.log); acted = true; }
    }
    if (state.winner) break;

    // Advance toward the strategic objective: the nearest enemy/neutral city.
    // (Adjacent enemy units are already dealt with by the attack step above.)
    if (!acted && unit.domain !== 'air' && unit.movesLeft > 0) {
      const objectives = [...state.tiles.values()]
        .filter(t => t.city && t.city.owner !== playerId);
      const foes = enemies();
      const reach = reachableTiles(state, unit);
      if (reach.size) {
        let best = null, bestScore = Infinity;
        for (const [k] of reach) {
          const [tq, tr] = k.split(',').map(Number);
          const tileHex = { q: tq, r: tr };
          let d;
          if (objectives.length) {
            d = Math.min(...objectives.map(c => hexDistance(tileHex, c)));
          } else if (foes.length) {
            d = Math.min(...foes.map(f => hexDistance(tileHex, f)));
          } else {
            d = 0;
          }
          if (d < bestScore) { bestScore = d; best = k; }
        }
        if (best) {
          const res = moveUnit(state, unit.id, best);
          if (res.ok) {
            // After moving, try to attack again.
            const t2 = attackableTargets(state, unit).filter(t => canAttack(state, unit, t.tileKey).ok);
            if (t2.length) {
              const r2 = attack(state, unit.id, t2[0].tileKey);
              if (r2.ok) log.push(...r2.log);
            }
          }
        }
      }
    }
  }

  state.log.push(...log);
  return { log, winner: checkWinner(state) };
}

// ---------------------------------------------------------------------------
// Rendering helpers (pure geometry — used by the browser UI)
// ---------------------------------------------------------------------------

// Pointy-top axial hex -> pixel centre. Kept here so the engine and UI agree.
export function hexToPixel(q, r, size) {
  return [size * Math.sqrt(3) * (q + r / 2), size * 1.5 * r];
}

export function hexCornerPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts;
}
