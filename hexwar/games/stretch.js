// hexwar/games/stretch.js
// "Stretch" — a hexish map with no terrain and no elevation. Instead, parts
// of the map are simply tiled more densely. Movement and ranged attacks are
// strictly tile-based (1 move per tile, range counted in tiles), so armies
// cross sparse country quickly and bog down where the tiling is fine.
// Dense regions are effectively difficult terrain made out of pure geometry.

import { generateHexishMap } from '../core/map.js';
import { SeededRandom, makeBlobField } from '../core/util.js';
import { placeArmies, placeObjectives } from './common.js';

const unitTypes = {
  infantry: { name: 'Infantry', symbol: 'I', cls: 'melee', str: 20, move: 2,
    note: 'Solid line unit. Move 2 tiles, melee only.' },
  ranger: { name: 'Ranger', symbol: 'R', cls: 'melee', str: 15, move: 4,
    note: 'Fast but fragile — 4 tiles a turn shines in sparse country.' },
  archer: { name: 'Archer', symbol: 'A', cls: 'ranged', str: 10, rangedStr: 16, range: 2, move: 2,
    note: 'Ranged 2 tiles. In dense areas 2 tiles is a stone’s throw; in sparse areas it is artillery.' },
  trebuchet: { name: 'Trebuchet', symbol: 'T', cls: 'ranged', str: 6, rangedStr: 22, range: 3, move: 1,
    note: 'Ranged 3 tiles, barely mobile. Devastating where tiles are large.' }
};

export const stretchRuleset = {
  key: 'stretch',
  title: 'Stretch — density is terrain',
  hint: [
    'HEXISH map: pentagons, hexagons and heptagons. No terrain, no elevation.',
    'Some regions are tiled much more densely than others (smaller cells).',
    'ALL movement and ranged attacks are strictly tile-counted, so units',
    'physically cover more ground per move where tiles are big, and crawl',
    'where the tiling is fine. Dense patches behave like forests or marshes',
    'without a single terrain rule existing.',
    'Score: hold a starred objective tile at the end of a round for 1 point.',
    `First to the target score wins; wiping the enemy out also wins.`
  ].join('\n'),

  options: { tileCount: 170, radius: 320, targetScore: 10, maxRounds: 50 },
  unitTypes,

  buildMap(opts) {
    const rng = new SeededRandom(opts.seed * 7 + 1);
    const field = makeBlobField(rng, { blobs: 5, radius: opts.radius, sharpness: 1.4 });
    const density = (x, y) => 0.55 + 4.5 * field(x, y) ** 2;
    const map = generateHexishMap({
      tileCount: opts.tileCount,
      radius: opts.radius,
      seed: opts.seed,
      density
    });
    for (const t of map.tiles) t.props.density = density(t.center[0], t.center[1]);
    return map;
  },

  setup(game) {
    placeObjectives(game, 3);
    placeArmies(game, ['infantry', 'infantry', 'ranger', 'archer', 'archer', 'trebuchet']);
  },

  moveCost() { return 1; },                       // every tile costs exactly 1
  attackRange(game, unit) { return game.unitType(unit).range || 1; }
};
