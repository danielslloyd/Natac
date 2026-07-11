// hexwar/tests/hexwar.test.js
// Run with: node --test hexwar/tests

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateHexMap, generateHexishMap, TileMap } from '../core/map.js';
import { Game } from '../core/engine.js';
import { lineOfSight } from '../core/los.js';
import { createGame, RULESETS } from '../games/index.js';
import { RandomAgent, HeuristicAgent, runMatch } from '../ai/agents.js';

// ── map layer ───────────────────────────────────────────────────────────────

test('hex map: symmetric neighbors, correct tile count, interior degree 6', () => {
  const map = generateHexMap({ radius: 4 });
  assert.equal(map.size, 1 + 3 * 4 * (4 + 1)); // 61
  for (const t of map.tiles) {
    assert.ok(t.neighbors.length >= 3 && t.neighbors.length <= 6);
    for (const n of t.neighbors) {
      assert.ok(map.tile(n).neighbors.includes(t.id), 'neighbors must be symmetric');
    }
  }
  const center = map.tiles.find(t => t.axial.q === 0 && t.axial.r === 0);
  assert.equal(center.neighbors.length, 6);
});

test('hex map: tileAtPoint inverts tile centers', () => {
  const map = generateHexMap({ radius: 3, hexSize: 20 });
  for (const t of map.tiles) {
    assert.equal(map.tileAtPoint(t.center[0], t.center[1]), t.id);
  }
});

test('hexish map: connected, symmetric, mostly 5-7 sided cells', () => {
  const map = generateHexishMap({ tileCount: 120, radius: 300, seed: 5 });
  assert.ok(map.size > 60, `expected a substantial map, got ${map.size}`);
  const d = map.bfsFrom(0);
  for (let i = 0; i < map.size; i++) assert.notEqual(d[i], -1, 'map must be connected');
  let hexish = 0;
  for (const t of map.tiles) {
    for (const n of t.neighbors) {
      assert.ok(map.tile(n).neighbors.includes(t.id), 'neighbors must be symmetric');
    }
    if (t.polygon.length >= 5 && t.polygon.length <= 7) hexish++;
  }
  assert.ok(hexish / map.size > 0.7, 'most cells should be pentagon/hexagon/heptagon');
});

test('hexish map with density field: dense areas produce smaller cells', () => {
  // density high on the left half, low on the right
  const density = x => (x < 0 ? 5 : 0.6);
  const map = generateHexishMap({ tileCount: 150, radius: 300, seed: 9, density });
  const area = poly => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    return Math.abs(a) / 2;
  };
  const left = map.tiles.filter(t => t.center[0] < -60);
  const right = map.tiles.filter(t => t.center[0] > 60);
  const avg = ts => ts.reduce((s, t) => s + area(t.polygon), 0) / ts.length;
  assert.ok(left.length > 5 && right.length > 5);
  assert.ok(avg(left) * 2 < avg(right),
    `left (dense) cells should be much smaller: ${avg(left).toFixed(0)} vs ${avg(right).toFixed(0)}`);
});

test('sharedEdge returns a real segment for adjacent tiles', () => {
  const map = generateHexMap({ radius: 2 });
  const t = map.tiles[0];
  const [p1, p2] = map.sharedEdge(t.id, t.neighbors[0]);
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  assert.ok(len > 1, 'shared edge should have real length');
});

// ── engine: a tiny hand-built ruleset for precise assertions ────────────────

function tinyRuleset(overrides = {}) {
  return {
    key: 'tiny', title: 'tiny', hint: '',
    options: { maxRounds: 100, targetScore: 999 },
    unitTypes: {
      grunt: { name: 'Grunt', symbol: 'g', cls: 'melee', str: 20, move: 2 },
      bow: { name: 'Bow', symbol: 'b', cls: 'ranged', str: 10, rangedStr: 16, range: 2, move: 2 }
    },
    buildMap: () => generateHexMap({ radius: 3, hexSize: 20 }),
    setup: () => {},
    moveCost: () => 1,
    attackRange: (g, u) => g.unitType(u).range || 1,
    ...overrides
  };
}

test('engine: movement budget limits reach, moving spends it', () => {
  const game = new Game({ ruleset: tinyRuleset(), seed: 1 });
  const center = game.map.tiles.find(t => t.axial.q === 0 && t.axial.r === 0);
  const unit = game.addUnit(0, 'grunt', center.id);
  game._refreshPlayer(0);
  const reach = game.reachable(unit);
  // move 2 on an open radius-3 map: ring1 (6) + ring2 (12) tiles
  assert.equal(reach.size, 18);
  const target = [...reach.entries()].find(([, v]) => v.cost === 2)[0];
  const res = game.applyAction({ type: 'move', unitId: unit.id, to: target });
  assert.ok(res.ok);
  assert.equal(unit.movesLeft, 0);
  assert.equal(game.reachable(unit).size, 0);
});

test('engine: dual budget (iso lines) blocks paths the move budget allows', () => {
  const rs = tinyRuleset({
    lineCost: (g, u, from, to) =>
      Math.abs((g.map.tile(to).props.elevation || 0) - (g.map.tile(from).props.elevation || 0)),
    lineBudget: () => 1
  });
  const game = new Game({ ruleset: rs, seed: 1 });
  // build a wall of elevation 3 splitting the map at q = 1
  for (const t of game.map.tiles) t.props.elevation = t.axial.q >= 1 ? 3 : 0;
  const center = game.map.tiles.find(t => t.axial.q === 0 && t.axial.r === 0);
  const unit = game.addUnit(0, 'grunt', center.id);
  game._refreshPlayer(0);
  const reach = game.reachable(unit);
  for (const [tileId] of reach) {
    assert.ok(game.map.tile(tileId).axial.q < 1,
      'tiles beyond the 3-line cliff must be unreachable with lineBudget 1');
  }
  assert.ok(reach.size > 0, 'flat side should still be reachable');
});

test('engine: melee combat damages both sides; kill advances attacker', () => {
  const game = new Game({ ruleset: tinyRuleset(), seed: 3 });
  const a = game.map.tiles.find(t => t.axial.q === 0 && t.axial.r === 0);
  const bTile = a.neighbors[0];
  const attacker = game.addUnit(0, 'grunt', a.id);
  const defender = game.addUnit(1, 'grunt', bTile);
  defender.hp = 20; // one hit kills
  game._refreshPlayer(0);
  const res = game.applyAction({ type: 'attack', unitId: attacker.id, target: bTile });
  assert.ok(res.ok);
  assert.ok(!game.units.has(defender.id), 'defender should die');
  assert.equal(attacker.tile, bTile, 'melee attacker advances into the tile');
  assert.ok(game.over && game.winner === 0, 'lone survivor wins by elimination');
});

test('engine: ranged attack draws no counterattack', () => {
  const game = new Game({ ruleset: tinyRuleset(), seed: 4 });
  const center = game.map.tiles.find(t => t.axial.q === 0 && t.axial.r === 0);
  const far = game.map.tiles.find(t => t.axial.q === 2 && t.axial.r === 0);
  const archer = game.addUnit(0, 'bow', center.id);
  const victim = game.addUnit(1, 'grunt', far.id);
  game._refreshPlayer(0);
  const res = game.applyAction({ type: 'attack', unitId: archer.id, target: far.id });
  assert.ok(res.ok);
  assert.equal(archer.hp, 100, 'ranged attacker takes no counter damage');
  assert.ok(victim.hp < 100);
});

test('engine: legalActions only for current player; endTurn rotates and refreshes', () => {
  const game = new Game({ ruleset: tinyRuleset(), seed: 5 });
  const t0 = game.map.tiles[0], t1 = game.map.tiles[game.map.size - 1];
  game.addUnit(0, 'grunt', t0.id);
  game.addUnit(1, 'grunt', t1.id);
  game._refreshPlayer(0);
  assert.equal(game.legalActions(1).length, 0);
  assert.ok(game.legalActions(0).length > 1);
  game.applyAction({ type: 'endTurn' });
  assert.equal(game.current, 1);
  const u1 = game.unitsOf(1)[0];
  assert.equal(u1.movesLeft, 2);
});

// ── line of sight ───────────────────────────────────────────────────────────

test('los: a tall ridge blocks, flat ground does not, high ground sees over', () => {
  const map = generateHexMap({ radius: 3, hexSize: 20 });
  const at = (q, r) => map.tiles.find(t => t.axial.q === q && t.axial.r === r).id;
  const elev = new Map(map.tiles.map(t => [t.id, 0]));
  const of = id => elev.get(id);

  const from = at(-2, 0), mid = at(0, 0), to = at(2, 0);
  assert.ok(lineOfSight(map, from, to, of).ok, 'flat ground: clear');

  elev.set(mid, 3);
  assert.equal(lineOfSight(map, from, to, of).ok, false, 'ridge blocks');

  // an elevated shooter cannot see past a midway ridge to a low target
  // (sight height at the midpoint is (4.5 + 0.5)/2 = 2.5 < 3)...
  elev.set(from, 4);
  assert.equal(lineOfSight(map, from, to, of).ok, false, 'distant low target still hidden');

  // ...but does see over a ridge close in front (sight height 3.5 > 3 there)
  elev.set(mid, 0);
  elev.set(at(-1, 0), 3);
  assert.ok(lineOfSight(map, from, to, of).ok, 'high shooter clears a nearby ridge');
});

// ── variants end to end ─────────────────────────────────────────────────────

for (const key of Object.keys(RULESETS)) {
  test(`variant ${key}: full random-vs-heuristic match completes`, () => {
    const game = createGame({ variant: key, seed: 21 });
    assert.equal(game.unitsOf(0).length, 6);
    assert.equal(game.unitsOf(1).length, 6);
    const result = runMatch(game, [new RandomAgent(1), new HeuristicAgent(2)]);
    assert.ok(game.over, 'game must finish');
    assert.ok(result.winner === 'draw' || result.winner === 0 || result.winner === 1);
  });
}

test('determinism: same seed + same agents => identical outcome', () => {
  const play = () => {
    const game = createGame({ variant: 'civ', seed: 33 });
    const r = runMatch(game, [new HeuristicAgent(5), new HeuristicAgent(6)]);
    return JSON.stringify([r.winner, r.rounds, r.scores, game.observe().units]);
  };
  assert.equal(play(), play());
});

test('observation is plain JSON and round-trips', () => {
  const game = createGame({ variant: 'surge', seed: 2 });
  const obs = game.observe();
  const back = JSON.parse(JSON.stringify(obs));
  assert.deepEqual(back, obs);
  assert.equal(typeof obs.props.waterLevel, 'number');
  const desc = game.describeMap();
  assert.ok(desc.tiles.length === game.map.size);
});

test('civ: zone of control makes enemy-adjacent steps expensive', () => {
  const game = createGame({ variant: 'civ', seed: 40 });
  // engineer a ZOC situation on any open plains cluster
  const rs = RULESETS.civ;
  const plains = game.map.tiles.filter(t => t.props.terrain === 'plains');
  let probe = null;
  outer: for (const t of plains) {
    for (const n of t.neighbors) {
      const nt = game.map.tile(n);
      if (nt.props.terrain !== 'plains') continue;
      const shared = t.neighbors.filter(x => nt.neighbors.includes(x))
        .filter(x => game.map.tile(x).props.terrain === 'plains');
      if (shared.length) { probe = { from: t.id, to: n, enemyAt: shared[0] }; break outer; }
    }
  }
  assert.ok(probe, 'need a plains triangle to test ZOC');
  for (const u of [...game.units.values()]) game.removeUnit(u);
  const mover = game.addUnit(0, 'swordsman', probe.from);
  game.addUnit(1, 'swordsman', probe.enemyAt);
  const cost = rs.moveCost(game, mover, probe.from, probe.to);
  assert.equal(cost, 2, 'ZOC step should cost the full move allowance');
});

test('surge: flooded tiles block land units, admit marines, drown stragglers', () => {
  const game = createGame({ variant: 'surge', seed: 8 });
  const rs = RULESETS.surge;
  const low = game.map.tiles.reduce((a, b) => a.props.elevation <= b.props.elevation ? a : b);
  assert.ok(low.props.elevation < 5, 'seeded map should have a low tile');

  // movement rules under a manually set flood
  game.props.waterLevel = low.props.elevation + 1;
  const dryNeighbor = low.neighbors.find(n => !game.unitsByTile.has(n)) ?? low.neighbors[0];
  const soldier = game.unitsOf(0).find(u => u.type === 'soldier');
  const marine = game.unitsOf(0).find(u => u.type === 'marine');
  assert.equal(rs.moveCost(game, soldier, dryNeighbor, low.id), Infinity);
  assert.equal(rs.moveCost(game, marine, dryNeighbor, low.id), 2);

  // drowning: round 4 is peak tide (level 5) with the 12-round sine cycle
  for (const u of [...game.units.values()]) if (u.tile === low.id) game.removeUnit(u);
  const victim = game.addUnit(0, 'soldier', low.id);
  victim.hp = 25;
  game.round = 4;
  rs.onRoundStart(game);
  assert.equal(game.props.waterLevel, 5);
  assert.ok(!game.units.has(victim.id), 'a 25hp soldier under 30 drowning damage dies');
});

test('rift: rift edges are impassable, bridged edges are not', () => {
  const game = createGame({ variant: 'rift', seed: 15 });
  const rs = RULESETS.rift;
  const edges = game.map.allEdges();
  const rift = edges.find(([a, b]) => {
    const e = game.map.edgeProp(a, b);
    return e && e.feature === 'rift' && !e.bridged;
  });
  assert.ok(rift, 'expected at least one unbridged rift on seed 15');
  const unit = game.unitsOf(0)[0];
  assert.equal(rs.moveCost(game, unit, rift[0], rift[1]), Infinity);
  game.map.setEdgeProp(rift[0], rift[1], { bridged: true });
  assert.equal(rs.moveCost(game, unit, rift[0], rift[1]), 1);
});
