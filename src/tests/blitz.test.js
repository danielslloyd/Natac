// Natac: Blitz (deck-building WW2 conquest) engine tests

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  CARDS, UNIT_TYPES, STARTING_DECK, STARTING_ARMY, BASE_HAND_SIZE,
  createGame, generateMap, validateAction, applyAction, reachableTiles,
  attackTargets, previewAttack, spawnUnit, unitAt, handSize, autoPayment
} from '../blitz/engine.js';
import { playAITurn } from '../blitz/ai.js';

// An empty, all-plains board with no units: handy for isolated rule tests.
function blankGame(mapType = 'hex') {
  const s = createGame({ mapType, seed: 3 });
  s.units = [];
  for (const t of s.tiles) if (t.hq === null && !t.depot) t.terrain = 'plains';
  return s;
}

function giveCard(s, playerId, key) {
  const c = { id: s.nextId++, key };
  s.players[playerId].hand.push(c);
  return c;
}

const freeTileNear = (s, from, d) => s.tiles.find(t => s.dist[from][t.id] === d && t.hq === null && !t.depot && !unitAt(s, t.id)).id;

describe('Blitz — map generation', () => {
  for (const mapType of ['hex', 'poly']) {
    test(`${mapType} map is connected, symmetric and has symmetric adjacency`, () => {
      const s = createGame({ mapType, seed: 11 });
      for (const t of s.tiles) {
        for (const n of t.neighbors) assert.ok(s.tiles[n].neighbors.includes(t.id), `adjacency ${t.id}<->${n}`);
        assert.strictEqual(s.tiles[t.mirror].mirror, t.id);
        assert.strictEqual(s.tiles[t.mirror].terrain, t.terrain);
        assert.ok(s.dist[0][t.id] < Infinity, 'connected');
      }
      assert.strictEqual(s.tiles[s.players[0].hq].mirror, s.players[1].hq);
      assert.strictEqual(s.tiles.filter(t => t.depot).length, 5);
    });
  }

  test('poly map has non-hexagonal tiles', () => {
    const m = generateMap({ mapType: 'poly', seed: 5 });
    const sides = new Set(m.tiles.map(t => t.neighbors.length));
    assert.ok([...sides].some(n => n !== 6));
  });
});

describe('Blitz — setup', () => {
  test('players start with deck, hand and army', () => {
    const s = createGame({ seed: 1 });
    for (const p of s.players) {
      assert.strictEqual(p.hand.length, BASE_HAND_SIZE);
      assert.strictEqual(p.hand.length + p.deck.length, STARTING_DECK.length);
      assert.strictEqual(s.units.filter(u => u.owner === p.id).length, STARTING_ARMY.length);
    }
  });
});

describe('Blitz — cards and pools', () => {
  test('resource cards fill pools; single-use cards leave the game', () => {
    const s = blankGame();
    const p = s.players[0];
    p.hand = [];
    const fuel = giveCard(s, 0, 'fuel3');
    const lend = giveCard(s, 0, 'funds4');
    applyAction(s, { type: 'playCard', cardId: fuel.id });
    applyAction(s, { type: 'playCard', cardId: lend.id });
    assert.strictEqual(p.pools.fuel, 3);
    assert.strictEqual(p.pools.funds, 4);
    assert.strictEqual(p.played.length, 1); // lend-lease is single use
  });

  test('wild cards require a chosen pool', () => {
    const s = blankGame();
    const w = giveCard(s, 0, 'wild2');
    assert.strictEqual(validateAction(s, { type: 'playCard', cardId: w.id }).ok, false);
    applyAction(s, { type: 'playCard', cardId: w.id, as: 'ammo' });
    assert.strictEqual(s.players[0].pools.ammo, 2);
  });

  test('buying: funds full value, other cards half, once per turn', () => {
    const s = blankGame();
    const p = s.players[0];
    p.hand = [];
    const f = giveCard(s, 0, 'funds2');
    const a = giveCard(s, 0, 'ammo1');
    const b = giveCard(s, 0, 'rations1');
    applyAction(s, { type: 'playCard', cardId: f.id });
    assert.strictEqual(validateAction(s, { type: 'buy', key: 'fuel3', payWith: [a.id] }).ok, false); // 2.5 < 4
    applyAction(s, { type: 'buy', key: 'rations3', payWith: [a.id, b.id] }); // 2 + 0.5 + 0.5 = 3
    assert.ok(p.discard.some(c => c.key === 'rations3'));
    assert.strictEqual(s.market.rations3, CARDS.rations3.stock - 1);
    assert.strictEqual(validateAction(s, { type: 'buy', key: 'rations2', payWith: [] }).ok, false);
  });

  test('autoPayment finds a payment or reports null', () => {
    const s = blankGame();
    const p = s.players[0];
    p.hand = [];
    giveCard(s, 0, 'funds1');
    giveCard(s, 0, 'ammo1');
    assert.strictEqual(autoPayment(s, 0, 5), null);
    assert.strictEqual(autoPayment(s, 0, 1.5).length, 2);
  });

  test('end of turn keeps unplayed cards and draws up to hand size', () => {
    const s = createGame({ seed: 2 });
    const p = s.players[0];
    const keep = p.hand[0];
    applyAction(s, { type: 'playCard', cardId: p.hand[1].id });
    applyAction(s, { type: 'endTurn' });
    assert.ok(p.hand.some(c => c.id === keep.id));
    assert.strictEqual(p.hand.length, handSize(s, 0));
    assert.strictEqual(s.current, 1);
  });

  test('trash action removes cards permanently', () => {
    const s = blankGame();
    const p = s.players[0];
    const total = () => p.deck.length + p.hand.length + p.discard.length + p.played.length;
    const before = total();
    const purge = giveCard(s, 0, 'purge');
    const victims = p.hand.filter(c => c.id !== purge.id).slice(0, 2).map(c => c.id);
    applyAction(s, { type: 'playCard', cardId: purge.id, trash: victims });
    assert.strictEqual(total(), before - 2); // purge is single-use, two trashed, +1 given -1 purge
  });

  test('reinforcement deploys a unit at HQ', () => {
    const s = blankGame();
    const c = giveCard(s, 0, 'reinfArm');
    applyAction(s, { type: 'playCard', cardId: c.id });
    const u = s.units.find(x => x.type === 'armor' && x.owner === 0);
    assert.ok(u);
    assert.ok(s.dist[s.players[0].hq][u.tile] <= 1);
  });
});

describe('Blitz — movement', () => {
  test('movement needs the right resource and respects terrain', () => {
    const s = blankGame();
    const hq = s.players[0].hq;
    const start = freeTileNear(s, hq, 2);
    const tank = spawnUnit(s, 0, 'armor', start);
    const inf = spawnUnit(s, 0, 'infantry', freeTileNear(s, hq, 3));
    s.players[0].pools.rations = 3;
    assert.strictEqual(reachableTiles(s, tank.id).size, 0, 'armor needs fuel');
    assert.ok(reachableTiles(s, inf.id).size > 0);

    s.players[0].pools.fuel = 2;
    const n = s.tiles[start].neighbors.find(id => !unitAt(s, id));
    s.tiles[n].terrain = 'forest';
    assert.strictEqual(reachableTiles(s, tank.id).get(n), 2);
    s.tiles[n].terrain = 'mountain';
    assert.ok(!reachableTiles(s, tank.id).has(n), 'armor cannot enter mountains');
    s.tiles[n].terrain = 'plains';
    applyAction(s, { type: 'move', unitId: tank.id, tileId: n });
    assert.strictEqual(s.players[0].pools.fuel, 1);
  });

  test('per-unit move cap limits big pools', () => {
    const s = blankGame();
    const art = spawnUnit(s, 0, 'artillery', freeTileNear(s, s.players[0].hq, 2));
    s.players[0].pools.fuel = 20;
    const maxCost = Math.max(...reachableTiles(s, art.id).values());
    assert.strictEqual(maxCost, UNIT_TYPES.artillery.maxMove);
  });

  test('ground units cannot pass enemies; aircraft fly over them', () => {
    const s = blankGame();
    const a = freeTileNear(s, s.players[0].hq, 2);
    const mid = s.tiles[a].neighbors.find(id => !unitAt(s, id) && s.tiles[id].hq === null);
    const beyond = s.tiles[mid].neighbors.find(id => s.dist[a][id] === 2 && !unitAt(s, id) && s.tiles[id].hq === null);
    for (const id of s.tiles[a].neighbors) if (id !== mid && !unitAt(s, id)) s.tiles[id].terrain = 'water';
    const inf = spawnUnit(s, 0, 'infantry', a);
    spawnUnit(s, 1, 'infantry', mid);
    s.players[0].pools.rations = 3;
    assert.ok(!reachableTiles(s, inf.id).has(beyond));
    inf.tile = freeTileNear(s, s.players[0].hq, 1);
    const air = spawnUnit(s, 0, 'air', a);
    s.players[0].pools.fuel = 3;
    assert.ok(reachableTiles(s, air.id).has(beyond));
  });

  test('capturing a depot and the enemy HQ', () => {
    const s = blankGame();
    const depot = s.tiles.find(t => t.depot);
    const from = depot.neighbors.find(id => !unitAt(s, id) && s.tiles[id].hq === null);
    const inf = spawnUnit(s, 0, 'infantry', from);
    spawnUnit(s, 1, 'infantry', s.tiles.find(t => t.id !== from && t.id !== depot.id && !unitAt(s, t.id) && t.hq === null).id);
    s.players[0].pools.rations = 3;
    applyAction(s, { type: 'move', unitId: inf.id, tileId: depot.id });
    assert.strictEqual(depot.owner, 0);
    assert.strictEqual(handSize(s, 0), BASE_HAND_SIZE + 1);

    const hq = s.players[1].hq;
    const tank = spawnUnit(s, 0, 'armor', s.tiles[hq].neighbors.find(id => !unitAt(s, id)));
    s.players[0].pools.fuel = 3;
    applyAction(s, { type: 'move', unitId: tank.id, tileId: hq });
    assert.strictEqual(s.winner, 0);
  });

  test('artillery and aircraft cannot capture the HQ', () => {
    const s = blankGame();
    const hq = s.players[1].hq;
    const art = spawnUnit(s, 0, 'artillery', s.tiles[hq].neighbors[0]);
    spawnUnit(s, 1, 'infantry', freeTileNear(s, hq, 3));
    s.players[0].pools.fuel = 3;
    assert.ok(!reachableTiles(s, art.id).has(hq));
  });
});

describe('Blitz — combat', () => {
  function duel(attType, defType, defTerrain = 'plains', dist = 1) {
    const s = blankGame();
    const a = freeTileNear(s, s.players[0].hq, 3);
    const d = s.tiles.find(t => s.dist[a][t.id] === dist && t.hq === null && !t.depot).id;
    s.tiles[d].terrain = defTerrain;
    const au = spawnUnit(s, 0, attType, a);
    const du = spawnUnit(s, 1, defType, d);
    s.players[0].pools.ammo = 5;
    return { s, au, du };
  }

  test('matchups: armor beats infantry in the open, struggles in forest', () => {
    const open = duel('armor', 'infantry', 'plains');
    const forest = duel('armor', 'infantry', 'forest');
    assert.ok(previewAttack(open.s, open.au.id, open.du.id).damage > previewAttack(forest.s, forest.au.id, forest.du.id).damage);
  });

  test('air shreds armor; armor cannot hit air; infantry can', () => {
    const { s, au, du } = duel('air', 'armor');
    assert.ok(previewAttack(s, au.id, du.id).damage >= 6);
    const t = duel('armor', 'air');
    assert.deepStrictEqual(attackTargets(t.s, t.au.id), []);
    const i = duel('infantry', 'air');
    assert.deepStrictEqual(attackTargets(i.s, i.au.id), [i.du.id]);
  });

  test('artillery fires at range 2-3 without counter-fire, not adjacent', () => {
    const near = duel('artillery', 'infantry', 'plains', 1);
    assert.deepStrictEqual(attackTargets(near.s, near.au.id), []);
    const far = duel('artillery', 'infantry', 'plains', 2);
    assert.deepStrictEqual(attackTargets(far.s, far.au.id), [far.du.id]);
    assert.strictEqual(previewAttack(far.s, far.au.id, far.du.id).counter, 0);
  });

  test('attack spends ammo, applies damage and counter, then unit cannot move', () => {
    const { s, au, du } = duel('infantry', 'infantry');
    const pr = previewAttack(s, au.id, du.id);
    applyAction(s, { type: 'attack', unitId: au.id, targetId: du.id });
    assert.strictEqual(s.players[0].pools.ammo, 4);
    assert.strictEqual(du.hp, UNIT_TYPES.infantry.hp - pr.damage);
    assert.strictEqual(au.hp, UNIT_TYPES.infantry.hp - pr.counter);
    s.players[0].pools.rations = 3;
    assert.strictEqual(reachableTiles(s, au.id).size, 0);
    assert.strictEqual(validateAction(s, { type: 'attack', unitId: au.id, targetId: du.id }).ok, false);
  });

  test('no ammo, no attack', () => {
    const { s, au } = duel('infantry', 'infantry');
    s.players[0].pools.ammo = 0;
    assert.deepStrictEqual(attackTargets(s, au.id), []);
  });
});

describe('Blitz — AI', () => {
  for (const mapType of ['hex', 'poly']) {
    test(`AI vs AI games on ${mapType} maps finish`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const s = createGame({ mapType, seed, players: [{ ai: true }, { ai: true }] });
        let turns = 0;
        while (s.winner === null && turns++ < 200) playAITurn(s);
        assert.notStrictEqual(s.winner, null, `seed ${seed} finished`);
      }
    });
  }
});
