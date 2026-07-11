// hexwar/games/hexiso.js
// "Hex Iso" — regular hexagon grid where every tile has an integer elevation.
// Tile centers render clear; elevation shows only as curving iso lines drawn
// along edges between tiles of different heights (one line per level of
// difference). Movement spends two budgets at once:
//   * moves  — tiles entered this turn (as usual)
//   * climb  — iso lines crossed this turn (= sum of |Δelevation| along path)
// Climb budgets differ by unit type, so ridges that stop a gun team are a
// staircase to mountaineers. Ranged units can use either a simple
// tiles-away range or a per-pair line-of-sight range (toggle: rangeMode).

import { generateHexMap } from '../core/map.js';
import { SeededRandom, makeBlobField, clamp } from '../core/util.js';
import { lineOfSight } from '../core/los.js';
import { placeArmies, placeObjectives } from './common.js';

const unitTypes = {
  infantry: { name: 'Infantry', symbol: 'I', cls: 'melee', str: 20, move: 2, climb: 3,
    note: 'Move 2 tiles, cross up to 3 iso lines per turn.' },
  mountaineer: { name: 'Mountaineer', symbol: 'M', cls: 'melee', str: 16, move: 3, climb: 7,
    note: 'Move 3, cross 7 lines — walks up cliffs others must go around.' },
  archer: { name: 'Archer', symbol: 'A', cls: 'ranged', str: 10, rangedStr: 15, range: 2, move: 2, climb: 2,
    note: 'Ranged 2. Only 2 climb — keep to the gentle slopes.' },
  gun: { name: 'Gun team', symbol: 'G', cls: 'ranged', str: 7, rangedStr: 22, range: 3, move: 1, climb: 1,
    note: 'Ranged 3 but crosses a single iso line per turn. High ground is forever.' }
};

export const hexIsoRuleset = {
  key: 'hexiso',
  title: 'Hex Iso — elevation as contour lines',
  hint: [
    'REGULAR hex grid; each tile has an integer elevation (0–6).',
    'Curved iso lines on an edge mark the elevation difference between the',
    'two adjacent tiles — 3 lines means a 3-level cliff.',
    'A unit spends TWO budgets while moving: tiles entered (move) and iso',
    'lines crossed (climb). Both refresh each turn; either can run out first.',
    'Fighting downhill: +15% attack per level of height advantage (max +45%).',
    'rangeMode toggle — "simple": targets within N tiles. "los": a per-pair',
    'sight line from eye height over the terrain; ridges block arrows.',
    'Hold starred objectives at round end to score.'
  ].join('\n'),

  options: { radius: 7, hexSize: 26, targetScore: 10, maxRounds: 50, rangeMode: 'simple' },
  unitTypes,

  buildMap(opts) {
    const map = generateHexMap({ radius: opts.radius, hexSize: opts.hexSize });
    const rng = new SeededRandom(opts.seed * 13 + 5);
    const worldR = opts.radius * opts.hexSize * 1.8;
    const field = makeBlobField(rng, { blobs: 7, radius: worldR, sharpness: 1.6 });
    for (const t of map.tiles) {
      t.props.elevation = clamp(Math.round(field(t.center[0], t.center[1]) * 6.99 - 0.5), 0, 6);
    }
    return map;
  },

  setup(game) {
    placeObjectives(game, 3);
    placeArmies(game, ['infantry', 'infantry', 'mountaineer', 'archer', 'archer', 'gun']);
  },

  moveCost() { return 1; },
  lineCost(game, unit, from, to) {
    return Math.abs(game.map.tile(to).props.elevation - game.map.tile(from).props.elevation);
  },
  lineBudget(game, unit) { return game.unitType(unit).climb; },

  attackRange(game, unit) { return game.unitType(unit).range || 1; },

  canTarget(game, unit, targetTile) {
    const type = game.unitType(unit);
    if (type.cls !== 'ranged' || game.options.rangeMode !== 'los') return { ok: true };
    const res = lineOfSight(game.map, unit.tile, targetTile,
      id => game.map.tile(id).props.elevation);
    return res.ok ? { ok: true } : { ok: false, reason: `ridge at tile ${res.blocker} blocks the shot` };
  },

  attackModifier(game, attacker, defenderTile) {
    const de = game.map.tile(attacker.tile).props.elevation
             - game.map.tile(defenderTile).props.elevation;
    return 1 + clamp(de, -3, 3) * 0.15;
  }
};
