// hexwar/games/rift.js
// "Rift" — terrain lives on the EDGES, not the tiles. Every tile is open
// ground, but the border between two tiles can be a river (crossing costs a
// unit's whole move, attacking across it is weaker) or a cliff rift
// (uncrossable). Because rifts appear wherever a smooth height field jumps,
// they form long coherent canyon lines across the map. A handful of edges
// are bridged from the start, and Pioneers can build new bridges — every
// bridge is a chokepoint worth fighting over. Ranged fire ignores edges
// entirely: arrows don't care about canyons.

import { generateHexMap } from '../core/map.js';
import { SeededRandom, makeBlobField } from '../core/util.js';
import { placeArmies, placeObjectives } from './common.js';

const unitTypes = {
  legion: { name: 'Legion', symbol: 'L', cls: 'melee', str: 21, move: 2,
    note: 'Line infantry. Hates attacking across rivers (−25%).' },
  horseman: { name: 'Horseman', symbol: 'H', cls: 'melee', str: 17, move: 4,
    note: 'Fast — but a river crossing still eats the whole move.' },
  skirmisher: { name: 'Skirmisher', symbol: 'K', cls: 'ranged', str: 9, rangedStr: 15, range: 2, move: 2,
    note: 'Ranged 2. Shoots straight over rifts and rivers.' },
  pioneer: { name: 'Pioneer', symbol: 'P', cls: 'melee', str: 8, move: 2,
    note: 'Weak fighter. Action: BRIDGE an adjacent river/rift edge (uses the turn).' }
};

export const riftRuleset = {
  key: 'rift',
  title: 'Rift — terrain on the edges',
  hint: [
    'REGULAR hex grid, every tile open ground. The terrain is the EDGES:',
    '· river edge (blue): crossing consumes the unit’s entire move, and melee',
    '  attacks across it hit at −25%.',
    '· rift edge (dark jagged): cannot be crossed at all.',
    '· bridge (brown): crosses freely. A few exist; Pioneers can build more',
    '  (stand next to the edge, use the Bridge action, costs the turn).',
    'Ranged fire ignores edges completely — canyons don’t stop arrows.',
    'Hold starred objectives at round end to score.'
  ].join('\n'),

  options: { radius: 7, hexSize: 26, targetScore: 10, maxRounds: 55 },
  unitTypes,

  buildMap(opts) {
    const map = generateHexMap({ radius: opts.radius, hexSize: opts.hexSize });
    const rng = new SeededRandom(opts.seed * 101 + 7);
    const worldR = opts.radius * opts.hexSize * 1.8;
    const field = makeBlobField(rng, { blobs: 8, radius: worldR, sharpness: 2.0 });
    for (const t of map.tiles) t.props.shade = field(t.center[0], t.center[1]);

    // edge features appear where the height field jumps between neighbors.
    // Thresholds are quantiles of the observed jumps so every seed gets a
    // similar share of features (top ~7% of edges become rifts, next ~12%
    // rivers) — with a small floor so a truly flat map stays featureless.
    const edges = map.allEdges();
    const diffOf = ([a, b]) => Math.abs(map.tile(a).props.shade - map.tile(b).props.shade);
    const sorted = edges.map(diffOf).sort((x, y) => x - y);
    const quantile = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const riftThresh = Math.max(0.03, quantile(0.93));
    const riverThresh = Math.max(0.015, quantile(0.81));
    for (const [a, b] of edges) {
      const diff = diffOf([a, b]);
      if (diff > riftThresh) map.setEdgeProp(a, b, { feature: 'rift' });
      else if (diff > riverThresh) map.setEdgeProp(a, b, { feature: 'river' });
    }

    // guarantee the map stays connected: bridge rift edges between components
    const blocked = (a, b) => {
      const e = map.edgeProp(a, b);
      return e && e.feature === 'rift' && !e.bridged;
    };
    for (let guard = 0; guard < 50; guard++) {
      const comp = new Int32Array(map.size).fill(-1);
      let nComp = 0;
      for (let i = 0; i < map.size; i++) {
        if (comp[i] !== -1) continue;
        const queue = [i]; comp[i] = nComp;
        for (let h = 0; h < queue.length; h++) {
          for (const n of map.neighbors(queue[h])) {
            if (comp[n] === -1 && !blocked(queue[h], n)) { comp[n] = nComp; queue.push(n); }
          }
        }
        nComp++;
      }
      if (nComp === 1) break;
      const candidates = map.allEdges().filter(([a, b]) => comp[a] !== comp[b] && blocked(a, b));
      if (!candidates.length) break;
      const [a, b] = candidates[rng.nextInt(0, candidates.length - 1)];
      map.setEdgeProp(a, b, { bridged: true });
    }

    // a couple of extra starting bridges over rivers, for flavor
    const rivers = map.allEdges().filter(([a, b]) => map.edgeProp(a, b)?.feature === 'river');
    for (let i = 0; i < 2 && rivers.length; i++) {
      const [a, b] = rivers[rng.nextInt(0, rivers.length - 1)];
      map.setEdgeProp(a, b, { bridged: true });
    }
    return map;
  },

  setup(game) {
    placeObjectives(game, 3);
    placeArmies(game, ['legion', 'legion', 'horseman', 'skirmisher', 'skirmisher', 'pioneer']);
  },

  moveCost(game, unit, from, to) {
    const e = game.map.edgeProp(from, to);
    if (!e || e.bridged) return 1;
    if (e.feature === 'rift') return Infinity;
    if (e.feature === 'river') return Math.max(1, game.unitType(unit).move);
    return 1;
  },

  attackRange(game, unit) { return game.unitType(unit).range || 1; },

  attackModifier(game, attacker, defenderTile) {
    if (game.unitType(attacker).cls !== 'melee') return 1;
    const e = game.map.edgeProp(attacker.tile, defenderTile);
    if (e && e.feature === 'river' && !e.bridged) return 0.75;
    return 1;
  },

  extraActions(game, unit) {
    if (unit.type !== 'pioneer' || unit.movesLeft <= 0) return [];
    const out = [];
    for (const n of game.map.neighbors(unit.tile)) {
      const e = game.map.edgeProp(unit.tile, n);
      if (e && (e.feature === 'river' || e.feature === 'rift') && !e.bridged) {
        out.push({ type: 'bridge', unitId: unit.id, to: n });
      }
    }
    return out;
  },

  applyExtraAction(game, unit, action) {
    if (action.type !== 'bridge') return { ok: false, reason: 'unknown action' };
    const e = game.map.edgeProp(unit.tile, action.to);
    if (!e || e.bridged || (e.feature !== 'river' && e.feature !== 'rift')) {
      return { ok: false, reason: 'nothing to bridge there' };
    }
    game.map.setEdgeProp(unit.tile, action.to, { bridged: true });
    unit.movesLeft = 0;
    unit.acted = true;
    game.say(`pioneer bridges the ${e.feature}`);
    return { ok: true, events: [{ kind: 'bridge', a: unit.tile, b: action.to }] };
  }
};
