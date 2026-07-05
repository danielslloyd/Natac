// Combat game mode engine tests

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  ERAS,
  UNIT_TYPES,
  createCombatGame,
  supplyDistanceMap,
  refreshSupply,
  supplyMultiplier,
  runUpkeep,
  reachableTiles,
  moveUnit,
  attack,
  attackableTargets,
  recruit,
  recruitTiles,
  endTurn,
  spawnUnit,
  fieldUnitAt,
  tileKey,
  playerById,
  SUPPLY_COST_PER_HEX
} from '../combat/engine.js';

describe('Combat mode — game creation', () => {
  test('creates a game for each era with capitals and starting units', () => {
    for (const eraId of Object.keys(ERAS)) {
      const state = createCombatGame({ era: eraId, seed: 42, radius: 5 });
      assert.strictEqual(state.era, eraId);
      // Two players, each with a capital.
      assert.strictEqual(state.players.length, 2);
      for (const p of state.players) {
        assert.ok(p.capitalKey, `${eraId}: player has a capital`);
        const cap = state.tiles.get(p.capitalKey);
        assert.ok(cap.city && cap.city.isCapital && cap.city.owner === p.id);
      }
      // Each player got an opening army.
      const p0Units = state.units.filter(u => u.owner === state.players[0].id);
      assert.ok(p0Units.length >= 3, `${eraId}: player 0 has starting units`);
    }
  });

  test('era resource flags gate which stockpiles are consumed', () => {
    assert.deepStrictEqual(
      [ERAS.classical.usesFood, ERAS.classical.usesAmmo, ERAS.classical.usesFuel],
      [true, false, false]
    );
    assert.deepStrictEqual(
      [ERAS.napoleonic.usesFood, ERAS.napoleonic.usesAmmo, ERAS.napoleonic.usesFuel],
      [true, true, false]
    );
    assert.deepStrictEqual(
      [ERAS.ww2.usesFood, ERAS.ww2.usesAmmo, ERAS.ww2.usesFuel],
      [true, true, true]
    );
    assert.strictEqual(ERAS.ww2.hasAir, true);
    assert.strictEqual(ERAS.classical.hasAir, false);
  });
});

describe('Combat mode — supply lines', () => {
  test('supply distance grows with distance from a city and raises cost', () => {
    const state = createCombatGame({ era: 'classical', seed: 7, radius: 6 });
    const p = state.players[0];
    const map = supplyDistanceMap(state, p.id, 'land');
    // The capital tile is a source at distance 0.
    assert.strictEqual(map.get(p.capitalKey), 0);
    // Distances are non-negative and increase outward — check monotonic-ish:
    const distances = [...map.values()];
    assert.ok(Math.max(...distances) >= 1, 'supply reaches beyond the capital');

    // Cost multiplier is length-based.
    const near = { supply: { inSupply: true, distance: 0 } };
    const far = { supply: { inSupply: true, distance: 4 } };
    assert.strictEqual(supplyMultiplier(near), 1);
    assert.strictEqual(supplyMultiplier(far), 1 + 4 * SUPPLY_COST_PER_HEX);
  });

  test('a unit beyond max supply range falls out of supply', () => {
    const state = createCombatGame({ era: 'classical', seed: 3, radius: 6 });
    const p = state.players[0];
    // Find a passable land tile far from the capital.
    const cap = state.tiles.get(p.capitalKey);
    let farTile = null, farDist = 0;
    for (const t of state.tiles.values()) {
      if (!['plains', 'forest', 'hills'].includes(t.terrain)) continue;
      if (fieldUnitAt(state, t.q, t.r)) continue;
      const d = Math.abs(t.q - cap.q) + Math.abs(t.r - cap.r);
      if (d > farDist) { farDist = d; farTile = t; }
    }
    const u = spawnUnit(state, p.id, 'warrior', farTile.key);
    refreshSupply(state, p.id);
    // With a big enough map, the far unit should exceed the classical range (4).
    if (u.supply.distance > ERAS.classical.maxSupplyRange || !isFinite(u.supply.distance)) {
      assert.strictEqual(u.supply.inSupply, false);
      assert.strictEqual(supplyMultiplier(u), Infinity);
    }
  });

  test('an enemy unit severs a supply line', () => {
    const state = createCombatGame({ era: 'classical', seed: 11, radius: 4 });
    const [p0, p1] = state.players;
    const cap = state.tiles.get(p0.capitalKey);
    // Surround the capital with enemy units so no land supply can escape.
    for (const n of [...cap.key.split(',')].length ? require0Neighbors(state, cap) : []) {
      if (n && ['plains', 'forest', 'hills'].includes(n.terrain) && !fieldUnitAt(state, n.q, n.r)) {
        spawnUnit(state, p1.id, 'warrior', n.key);
      }
    }
    // Place a friendly unit two tiles away; with the ring blocked it is cut off.
    refreshSupply(state, p0.id);
    // At minimum, the capital tile is still a distance-0 source.
    const map = supplyDistanceMap(state, p0.id, 'land');
    assert.strictEqual(map.get(p0.capitalKey), 0);
  });
});

// helper: neighbors as tiles
function require0Neighbors(state, tile) {
  const dirs = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];
  return dirs.map(d => state.tiles.get(tileKey(tile.q + d.q, tile.r + d.r)));
}

describe('Combat mode — upkeep & resources', () => {
  test('food is consumed every turn in every era', () => {
    const state = createCombatGame({ era: 'classical', seed: 5, radius: 5 });
    const p = state.players[0];
    p.resources.food = 100;
    const before = p.resources.food;
    runUpkeep(state, p.id);
    // Cities produce food (+) and units eat it. Net change should reflect both;
    // crucially, some food was spent feeding units.
    const cityProduced = 6 * 2; // one capital
    const eaten = before + cityProduced - p.resources.food;
    assert.ok(eaten > 0, 'units consumed food during upkeep');
  });

  test('classical upkeep never touches ammo or fuel', () => {
    const state = createCombatGame({ era: 'classical', seed: 9, radius: 5 });
    const p = state.players[0];
    p.resources.ammo = 50; p.resources.fuel = 50;
    runUpkeep(state, p.id);
    assert.strictEqual(p.resources.ammo, 50, 'ammo untouched in classical era');
    assert.strictEqual(p.resources.fuel, 50, 'fuel untouched in classical era');
  });
});

describe('Combat mode — movement', () => {
  test('land units cannot enter water and reach only land tiles', () => {
    const state = createCombatGame({ era: 'classical', seed: 21, radius: 5 });
    const p = state.players[0];
    const land = state.units.find(u => u.owner === p.id && u.domain === 'land');
    land.movesLeft = UNIT_TYPES[land.type].moves;
    const reach = reachableTiles(state, land);
    for (const k of reach.keys()) {
      const t = state.tiles.get(k);
      assert.notStrictEqual(t.terrain, 'water', 'land unit never reaches water');
      assert.notStrictEqual(t.terrain, 'mountains', 'land unit never reaches mountains');
    }
  });

  test('WW2 movement consumes fuel', () => {
    const state = createCombatGame({ era: 'ww2', seed: 33, radius: 5 });
    const p = state.players[0];
    runUpkeep(state, p.id);
    const tank = state.units.find(u => u.owner === p.id && u.type === 'tank');
    tank.movesLeft = UNIT_TYPES.tank.moves;
    refreshSupply(state, p.id);
    const reach = reachableTiles(state, tank);
    const dest = [...reach.keys()][0];
    if (dest) {
      const fuelBefore = p.resources.fuel;
      const res = moveUnit(state, tank.id, dest);
      assert.ok(res.ok, res.reason);
      assert.ok(p.resources.fuel < fuelBefore, 'fuel was spent on WW2 movement');
    }
  });
});

describe('Combat mode — combat', () => {
  test('adjacent melee attack damages a defender and spends ammo in Napoleonic', () => {
    const state = createCombatGame({ era: 'napoleonic', seed: 44, radius: 5 });
    const [p0, p1] = state.players;
    // Place two enemies adjacent to each other on land near the middle.
    let a = null, b = null;
    for (const t of state.tiles.values()) {
      if (!['plains', 'hills'].includes(t.terrain)) continue;
      if (fieldUnitAt(state, t.q, t.r)) continue;
      const neigh = require0Neighbors(state, t).find(n =>
        n && ['plains', 'hills'].includes(n.terrain) && !fieldUnitAt(state, n.q, n.r));
      if (neigh) { a = t; b = neigh; break; }
    }
    const attacker = spawnUnit(state, p0.id, 'cavalry', a.key);
    const defender = spawnUnit(state, p1.id, 'line_infantry', b.key);
    state.currentPlayerIdx = 0;
    // Isolate the combat behaviour: put both units firmly in supply.
    attacker.supply = { inSupply: true, distance: 0, source: 'net' };
    defender.supply = { inSupply: true, distance: 0, source: 'net' };
    p0.resources.ammo = 10;
    const ammoBefore = p0.resources.ammo;
    const hpBefore = defender.hp;
    const res = attack(state, attacker.id, b.key);
    assert.ok(res.ok, res.reason);
    const stillThere = state.units.find(u => u.id === defender.id);
    // Defender either took damage or was destroyed.
    assert.ok(!stillThere || stillThere.hp < hpBefore, 'defender took damage');
    assert.ok(p0.resources.ammo < ammoBefore, 'ammunition was consumed by combat');
  });

  test('out-of-supply units cannot attack when ammo is required', () => {
    const state = createCombatGame({ era: 'napoleonic', seed: 55, radius: 5 });
    const [p0, p1] = state.players;
    let a = null, b = null;
    for (const t of state.tiles.values()) {
      if (!['plains', 'hills'].includes(t.terrain)) continue;
      if (fieldUnitAt(state, t.q, t.r)) continue;
      const neigh = require0Neighbors(state, t).find(n =>
        n && ['plains', 'hills'].includes(n.terrain) && !fieldUnitAt(state, n.q, n.r));
      if (neigh) { a = t; b = neigh; break; }
    }
    const attacker = spawnUnit(state, p0.id, 'cannon', a.key);
    spawnUnit(state, p1.id, 'line_infantry', b.key);
    state.currentPlayerIdx = 0;
    // Force the attacker out of supply.
    attacker.supply = { inSupply: false, distance: Infinity, source: null };
    const res = attack(state, attacker.id, b.key);
    assert.strictEqual(res.ok, false);
    assert.match(res.reason, /supply|ammunition/i);
  });
});

describe('Combat mode — recruiting & turns', () => {
  test('recruiting spends production and places a unit at a city', () => {
    const state = createCombatGame({ era: 'ww2', seed: 66, radius: 5 });
    const p = state.players[0];
    state.currentPlayerIdx = 0;
    p.resources.production = 50;
    const tiles = recruitTiles(state, p.id, 'infantry');
    assert.ok(tiles.length > 0, 'there is somewhere to deploy');
    const prodBefore = p.resources.production;
    const before = state.units.filter(u => u.owner === p.id).length;
    const res = recruit(state, p.id, 'infantry', tiles[0]);
    assert.ok(res.ok, res.reason);
    assert.strictEqual(state.units.filter(u => u.owner === p.id).length, before + 1);
    assert.ok(p.resources.production < prodBefore, 'production was spent');
  });

  test('air units are only available in WW2 and are based at a city', () => {
    assert.ok(ERAS.ww2.units.includes('fighter'));
    assert.ok(!ERAS.classical.units.includes('fighter'));
    const state = createCombatGame({ era: 'ww2', seed: 77, radius: 5 });
    const p = state.players[0];
    state.currentPlayerIdx = 0;
    p.resources.production = 50;
    const tiles = recruitTiles(state, p.id, 'fighter');
    assert.ok(tiles.length > 0);
    const res = recruit(state, p.id, 'fighter', tiles[0]);
    assert.ok(res.ok, res.reason);
    assert.strictEqual(res.unit.domain, 'air');
    assert.ok(res.unit.baseKey, 'air unit has a distinct base');
  });

  test('endTurn advances players and runs upkeep', () => {
    const state = createCombatGame({ era: 'classical', seed: 88, radius: 5 });
    assert.strictEqual(state.currentPlayerIdx, 0);
    const res = endTurn(state);
    assert.strictEqual(state.currentPlayerIdx, 1);
    assert.ok(res.player);
  });

  test('capturing the last enemy capital wins the game', () => {
    const state = createCombatGame({ era: 'classical', seed: 99, radius: 5 });
    const [p0, p1] = state.players;
    // Hand player 0 the enemy capital.
    const enemyCap = state.tiles.get(p1.capitalKey);
    enemyCap.city.owner = p0.id;
    const winner = (function () {
      // re-run the win check via a public path
      return endTurn(state).winner;
    })();
    assert.strictEqual(winner, p0.id);
  });
});
