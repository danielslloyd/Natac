// hexwar/games/surge.js
// "Surge" — a hexish map with integer elevation and a tide that never stops.
// The water level rises and falls on a fixed 12-round cycle (fully forecast:
// next round's level is always shown). Tiles below the waterline flood:
// land units can't enter, and any non-amphibious unit caught by the rising
// tide drowns by degrees. Marines wade through the shallows. Causeways
// appear and vanish, and yesterday's safe camp is tomorrow's seabed —
// the map itself is the changing battlefield.

import { generateHexishMap } from '../core/map.js';
import { SeededRandom, makeBlobField, clamp } from '../core/util.js';
import { placeArmies, placeObjectives } from './common.js';

const CYCLE = 12;        // rounds per full tide cycle
const DROWN_DMG = 30;

const unitTypes = {
  soldier: { name: 'Soldier', symbol: 'S', cls: 'melee', str: 20, move: 2,
    note: 'Solid, but drowns if the tide catches it.' },
  marine: { name: 'Marine', symbol: 'M', cls: 'melee', str: 16, move: 2,
    note: 'AMPHIBIOUS — wades flooded tiles (2 moves each), never drowns.' },
  raider: { name: 'Raider', symbol: 'R', cls: 'melee', str: 15, move: 4,
    note: 'Fast enough to dash across a causeway before it closes.' },
  mortar: { name: 'Mortar', symbol: 'T', cls: 'ranged', str: 6, rangedStr: 21, range: 3, move: 1,
    note: 'Ranged 3. Slow — plan around the tide table or lose it to the sea.' }
};

function waterLevelAt(round) {
  return Math.round(2 + 3 * Math.sin((2 * Math.PI * (round - 1)) / CYCLE));
}

function flooded(game, tileId) {
  return game.map.tile(tileId).props.elevation < game.props.waterLevel;
}

export const surgeRuleset = {
  key: 'surge',
  title: 'Surge — fight the tide',
  hint: [
    'HEXISH map with integer elevation 0–8 and a TIDE on a 12-round cycle.',
    'Tiles below the current water level are flooded: land units cannot',
    'enter, and a non-amphibious unit caught by rising water takes',
    `${DROWN_DMG} damage per round until it climbs out. Marines wade flooded`,
    'tiles at 2 moves each and never drown.',
    'The forecast is exact — the panel shows this round’s and next round’s',
    'water level. Low tide opens causeways; high tide cuts armies in half.',
    'Height advantage: +12% attack per level (max ±36%).',
    'Hold starred objectives (they sit on high ground) at round end to score.'
  ].join('\n'),

  options: { tileCount: 160, radius: 310, targetScore: 10, maxRounds: 55 },
  unitTypes,

  buildMap(opts, game) {
    const map = generateHexishMap({
      tileCount: opts.tileCount, radius: opts.radius, seed: opts.seed
    });
    const rng = new SeededRandom(opts.seed * 47 + 3);
    const field = makeBlobField(rng, { blobs: 7, radius: opts.radius, sharpness: 1.7 });
    for (const t of map.tiles) {
      t.props.elevation = clamp(Math.round(field(t.center[0], t.center[1]) * 8.99 - 0.5), 0, 8);
    }
    return map;
  },

  setup(game) {
    game.props.waterLevel = waterLevelAt(1);
    game.props.waterNext = waterLevelAt(2);
    const highGround = id => game.map.tile(id).props.elevation >= 4;
    placeObjectives(game, 3, highGround);
    placeArmies(game, ['soldier', 'soldier', 'marine', 'marine', 'raider', 'mortar'],
      id => game.map.tile(id).props.elevation >= 4);
  },

  onRoundStart(game) {
    game.props.waterLevel = waterLevelAt(game.round);
    game.props.waterNext = waterLevelAt(game.round + 1);
    // drowning check for every unit caught below the waterline
    for (const unit of [...game.units.values()]) {
      if (unit.type === 'marine') continue;
      if (flooded(game, unit.tile)) {
        unit.hp -= DROWN_DMG;
        game.say(`${game.unitType(unit).symbol} of P${unit.owner + 1} is drowning (-${DROWN_DMG})`);
        if (unit.hp <= 0) {
          game.removeUnit(unit);
          game.say(`${game.unitType(unit).symbol} lost to the sea`);
        }
      }
    }
    game._checkElimination();
  },

  moveCost(game, unit, from, to) {
    if (flooded(game, to)) {
      return unit.type === 'marine' ? 2 : Infinity;
    }
    return 1;
  },

  attackRange(game, unit) { return game.unitType(unit).range || 1; },

  attackModifier(game, attacker, defenderTile) {
    const de = game.map.tile(attacker.tile).props.elevation
             - game.map.tile(defenderTile).props.elevation;
    return 1 + clamp(de, -3, 3) * 0.12;
  }
};
