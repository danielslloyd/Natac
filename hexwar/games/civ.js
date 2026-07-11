// hexwar/games/civ.js
// "Civ" — as close as practical to Civilization V's one-unit-per-tile combat:
// terrain movement costs, defense bonuses, zone of control, fortifying,
// ranged fire blocked by obstacles (unless shooting from a hill), melee
// counterattacks, HP-scaled strength. Runs on a regular hex grid or a hexish
// polygon map — toggle with the mapStyle option.

import { generateHexMap, generateHexishMap } from '../core/map.js';
import { SeededRandom, makeBlobField } from '../core/util.js';
import { placeArmies, placeObjectives } from './common.js';

const TERRAIN = {
  plains:   { cost: 1, def: 1.0,  height: 0, passable: true },
  forest:   { cost: 2, def: 1.25, height: 1, passable: true },
  hill:     { cost: 2, def: 1.25, height: 1, passable: true },
  mountain: { cost: Infinity, def: 1, height: 3, passable: false },
  water:    { cost: Infinity, def: 1, height: 0, passable: false }
};

const unitTypes = {
  swordsman: { name: 'Swordsman', symbol: 'S', cls: 'melee', str: 22, move: 2,
    note: 'Front line. Takes counterattack damage, advances on kills.' },
  horseman: { name: 'Horseman', symbol: 'H', cls: 'melee', str: 18, move: 4,
    note: 'Fast flanker, but zone of control still drags on it.' },
  archer: { name: 'Archer', symbol: 'A', cls: 'ranged', str: 9, rangedStr: 15, range: 2, move: 2,
    note: 'Ranged 2. No counterattack against it. Forests/hills block its shots.' },
  catapult: { name: 'Catapult', symbol: 'C', cls: 'ranged', str: 6, rangedStr: 21, range: 3, move: 1,
    note: 'Ranged 3, fragile in melee — screen it.' }
};

function terrainOf(game, tileId) {
  return TERRAIN[game.map.tile(tileId).props.terrain];
}

function adjacentToEnemy(game, tileId, playerId) {
  for (const n of game.map.neighbors(tileId)) {
    const u = game.unitAt(n);
    if (u && u.owner !== playerId) return true;
  }
  return false;
}

export const civRuleset = {
  key: 'civ',
  title: 'Civ — Civilization V combat',
  hint: [
    'Terrain: plains (1 move), forest/hill (2 moves, +25% defense),',
    'mountains & water impassable. One unit per tile.',
    'ZONE OF CONTROL: stepping between two tiles that are both adjacent to an',
    'enemy consumes the unit’s entire movement for the step.',
    'Melee attacks suffer a counterattack and advance into the tile on a kill.',
    'Ranged attacks (no counterattack): forests/hills/mountains between the',
    'shooter and the target block the shot — unless the shooter stands on a',
    'hill. Fortify (+25% defense, unit also heals while idle).',
    'mapStyle option: "hex" for a regular grid, "hexish" for polygon soup.',
    'Hold starred objectives at round end to score.'
  ].join('\n'),

  options: { mapStyle: 'hex', radius: 7, hexSize: 26, tileCount: 150, mapRadius: 300,
             targetScore: 10, maxRounds: 60 },
  unitTypes,

  buildMap(opts) {
    const map = opts.mapStyle === 'hexish'
      ? generateHexishMap({ tileCount: opts.tileCount, radius: opts.mapRadius, seed: opts.seed })
      : generateHexMap({ radius: opts.radius, hexSize: opts.hexSize });

    const rng = new SeededRandom(opts.seed * 31 + 17);
    const worldR = opts.mapStyle === 'hexish' ? opts.mapRadius : opts.radius * opts.hexSize * 1.8;
    const relief = makeBlobField(rng, { blobs: 6, radius: worldR, sharpness: 1.5 });
    const woods = makeBlobField(rng, { blobs: 7, radius: worldR, sharpness: 1.5 });

    for (const t of map.tiles) {
      const [x, y] = t.center;
      const r = relief(x, y), w = woods(x, y);
      let terrain = 'plains';
      if (r > 0.86) terrain = 'mountain';
      else if (r < 0.13) terrain = 'water';
      else if (r > 0.66) terrain = 'hill';
      else if (w > 0.68) terrain = 'forest';
      t.props.terrain = terrain;
    }
    return map;
  },

  setup(game) {
    const passable = id => terrainOf(game, id).passable;
    placeObjectives(game, 3, passable);
    placeArmies(game, ['swordsman', 'swordsman', 'horseman', 'archer', 'archer', 'catapult'], passable);
  },

  moveCost(game, unit, from, to) {
    const t = terrainOf(game, to);
    if (!t.passable) return Infinity;
    // zone of control: leaving an enemy-adjacent tile for another
    // enemy-adjacent tile costs the unit's whole move allowance
    if (adjacentToEnemy(game, from, unit.owner) && adjacentToEnemy(game, to, unit.owner)) {
      return Math.max(t.cost, game.unitType(unit).move);
    }
    return t.cost;
  },

  attackRange(game, unit) { return game.unitType(unit).range || 1; },

  canTarget(game, unit, targetTile) {
    const type = game.unitType(unit);
    if (type.cls !== 'ranged') return { ok: true };
    const d = game.map.bfsFrom(unit.tile)[targetTile];
    if (d <= 1) return { ok: true };
    const onHill = game.map.tile(unit.tile).props.terrain === 'hill';
    // sample the straight line between centers for blocking terrain
    const a = game.map.tile(unit.tile).center, b = game.map.tile(targetTile).center;
    const steps = Math.max(6, d * 4);
    const seen = new Set([unit.tile, targetTile]);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const id = game.map.tileAtPoint(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (id === -1 || seen.has(id)) continue;
      seen.add(id);
      const terr = game.map.tile(id).props.terrain;
      if (terr === 'mountain') return { ok: false, reason: 'mountain blocks the shot' };
      if (!onHill && (terr === 'forest' || terr === 'hill')) {
        return { ok: false, reason: `${terr} blocks the shot (get on a hill for indirect fire)` };
      }
    }
    return { ok: true };
  },

  defenseModifier(game, defender) {
    return terrainOf(game, defender.tile).def;
  },

  extraActions(game, unit) {
    if (!unit.fortified && unit.movesLeft > 0) {
      return [{ type: 'fortify', unitId: unit.id }];
    }
    return [];
  },

  applyExtraAction(game, unit, action) {
    if (action.type !== 'fortify') return { ok: false, reason: 'unknown action' };
    unit.fortified = true;
    unit.movesLeft = 0;
    // note: acted stays false, so a fortified unit heals at end of turn
    return { ok: true, events: [{ kind: 'fortify', unitId: unit.id }] };
  }
};
