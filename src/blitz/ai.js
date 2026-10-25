// Natac: Blitz — heuristic AI
//
// `nextAIAction(state)` returns the single next action for the current player,
// so the UI can animate an AI turn step by step and headless runs can loop it.
// Every action it returns consumes something (a card, a unit's move, a unit's
// attack, the turn's purchase), so a turn always terminates in `endTurn`.

import {
  CARDS, UNIT_TYPES, RESOURCES, MATCHUP,
  currentPlayer, unitById, reachableTiles, attackTargets, previewAttack,
  deployTile, validateAction, applyAction, withinAirRange
} from './engine.js';

const UNIT_VALUE = { infantry: 4, armor: 6, artillery: 5, air: 6 };

function needs(state, p) {
  const mine = state.units.filter(u => u.owner === p.id);
  const need = { rations: 0, fuel: 0, ammo: 0 };
  for (const u of mine) {
    const T = UNIT_TYPES[u.type];
    need[T.moveRes] += Math.min(T.maxMove, 3);
    need.ammo += T.ammo;
  }
  return need;
}

function attackScore(state, a, d) {
  const r = previewAttack(state, a.id, d.id);
  const val = UNIT_VALUE[d.type] / UNIT_TYPES[d.type].hp;
  const own = UNIT_VALUE[a.type] / UNIT_TYPES[a.type].hp;
  let s = Math.min(r.damage, d.hp) * val - Math.min(r.counter, a.hp) * own;
  if (r.kills) s += UNIT_VALUE[d.type];
  if (r.dies) s -= UNIT_VALUE[a.type] * 2;
  return s;
}

function bestAttack(state, p) {
  let best = null;
  for (const u of state.units) {
    if (u.owner !== p.id) continue;
    for (const tid of attackTargets(state, u.id)) {
      const s = attackScore(state, u, unitById(state, tid));
      if (s > 0 && (!best || s > best.score)) best = { score: s, unitId: u.id, targetId: tid };
    }
  }
  return best;
}

// How threatening a tile is: rough sum of damage enemies could deal next turn.
function threatAt(state, u, tileId) {
  let t = 0;
  for (const e of state.units) {
    if (e.owner === u.owner) continue;
    const E = UNIT_TYPES[e.type];
    if (!MATCHUP[e.type][u.type]) continue;
    const reach = Math.min(E.maxMove, 3) + E.range;
    if (state.dist[e.tile][tileId] <= reach) t += E.atk * MATCHUP[e.type][u.type];
  }
  return t;
}

function tileScore(state, u, tileId) {
  const p = state.players[u.owner];
  const enemy = state.players[1 - u.owner];
  const T = UNIT_TYPES[u.type];
  const tile = state.tiles[tileId];
  const d = state.dist;
  let s = 0;

  if (T.captures) {
    if (tileId === enemy.hq) return 1e6;
    s -= 3 * d[tileId][enemy.hq];
    if (tile.depot && tile.owner !== p.id) s += 18;
  }
  const enemies = state.units.filter(e => e.owner !== u.owner);
  const nearest = enemies.length ? Math.min(...enemies.map(e => d[tileId][e.tile])) : 99;

  if (u.type === 'artillery') {
    s -= 2 * d[tileId][enemy.hq] * 0.5;
    if (nearest >= 2 && nearest <= 3) s += 12;
    if (nearest === 1) s -= 10;
  }
  if (u.type === 'air') {
    const prey = enemies.filter(e => MATCHUP.air[e.type] >= 1.4);
    const pd = prey.length ? Math.min(...prey.map(e => d[tileId][e.tile])) : nearest;
    s -= 3 * pd;
    if (!withinAirRange(state, u.owner, tileId)) s -= 50;
  }

  // Defend our own HQ if enemies are close to it.
  const raiders = enemies.filter(e => UNIT_TYPES[e.type].captures && d[e.tile][p.hq] <= 4);
  if (raiders.length && u.type !== 'air') s -= 2 * Math.min(...raiders.map(e => d[tileId][e.tile]));

  // Could we shoot something from here this turn?
  if (!u.attacked && p.pools.ammo >= T.ammo) {
    for (const e of enemies) {
      const dd = d[tileId][e.tile];
      if (MATCHUP[u.type][e.type] && dd >= T.minRange && dd <= T.range) { s += 6; break; }
    }
  }
  s -= 0.4 * threatAt(state, u, tileId);
  return s;
}

function bestMove(state, p, skip) {
  let best = null;
  for (const u of state.units) {
    if (u.owner !== p.id || u.moved > 0 || u.attacked || skip.has(u.id)) continue;
    const here = tileScore(state, u, u.tile);
    for (const [tileId, cost] of reachableTiles(state, u.id)) {
      const gain = tileScore(state, u, tileId) - here - 0.1 * cost;
      if (gain > 0.5 && (!best || gain > best.gain)) best = { gain, unitId: u.id, tileId };
    }
  }
  return best;
}

function chooseWild(state, p) {
  const need = needs(state, p);
  let best = 'funds', bv = -Infinity;
  for (const k of ['rations', 'fuel', 'ammo']) {
    const v = need[k] - p.pools[k];
    if (v > bv) { bv = v; best = k; }
  }
  return bv > 0 ? best : 'funds';
}

// Weakest cards in hand to trash: starters first, keeping a minimum deck size.
function trashPicks(state, p, card, max) {
  const deckSize = p.deck.length + p.hand.length + p.discard.length + p.played.length;
  const room = Math.max(0, deckSize - 8);
  return p.hand
    .filter(c => c.id !== card.id && CARDS[c.key].starter)
    .slice(0, Math.min(max, room))
    .map(c => c.id);
}

function chooseBuy(state, p) {
  const mine = state.units.filter(u => u.owner === p.id);
  const enemy = state.units.filter(u => u.owner !== p.id);
  const count = t => mine.filter(u => u.type === t).length;
  const enemyArmor = enemy.filter(u => u.type === 'armor' || u.type === 'artillery').length;
  const funds = p.pools.funds;
  const affordable = Object.keys(state.market).filter(k => state.market[k] > 0 && CARDS[k].cost <= funds);
  if (!affordable.length) return null;

  const pref = k => {
    const C = CARDS[k];
    let v = C.cost;
    if (C.effect?.deploy) {
      const t = C.effect.deploy;
      v += mine.length < 5 ? 4 : mine.length < 7 ? 1 : -4;
      if (t === 'air' && enemyArmor >= 2 && count('air') < 2) v += 2;
      if (t === 'infantry' && count('infantry') < 2) v += 2;
    }
    if (C.type in RESOURCES) {
      const need = needs(state, p)[C.type] ?? 0;
      v += need > 4 ? 1 : 0;
    }
    if (C.effect?.trash && !C.effect.draw) v -= 1;
    return v;
  };
  affordable.sort((a, b) => pref(b) - pref(a));
  return affordable[0];
}

export function nextAIAction(state) {
  const p = currentPlayer(state);
  state._ai = state._ai && state._ai.turnKey === `${state.round}:${p.id}` ? state._ai : { turnKey: `${state.round}:${p.id}`, skip: new Set() };
  const ok = a => validateAction(state, a).ok;

  // 1. Card-draw / trash actions first, so drawn cards can also be played.
  for (const c of p.hand) {
    const C = CARDS[c.key];
    if (C.type !== 'action' || C.effect.deploy) continue;
    const a = { type: 'playCard', cardId: c.id, trash: C.effect.trash ? trashPicks(state, p, c, C.effect.trash) : [] };
    if (ok(a)) return a;
  }
  // 2. Reinforcements.
  for (const c of p.hand) {
    const C = CARDS[c.key];
    if (C.effect?.deploy && deployTile(state, p.id, C.effect.deploy) !== null) return { type: 'playCard', cardId: c.id };
  }
  // 3. Commit every resource card to the pools.
  for (const c of p.hand) {
    const C = CARDS[c.key];
    if (C.type in RESOURCES) return { type: 'playCard', cardId: c.id };
    if (C.type === 'wild') return { type: 'playCard', cardId: c.id, as: chooseWild(state, p) };
  }
  // 4. Attacks available right now.
  const atk = bestAttack(state, p);
  if (atk) return { type: 'attack', unitId: atk.unitId, targetId: atk.targetId };
  // 5. Moves.
  const mv = bestMove(state, p, state._ai.skip);
  if (mv) return { type: 'move', unitId: mv.unitId, tileId: mv.tileId };
  // 6. Buy.
  if (!p.bought) {
    const key = chooseBuy(state, p);
    if (key) return { type: 'buy', key, payWith: [] };
  }
  return { type: 'endTurn' };
}

// Play out the current player's whole turn. Returns the actions taken.
export function playAITurn(state, maxActions = 200) {
  const taken = [];
  const startPlayer = state.current;
  while (state.winner === null && state.current === startPlayer && taken.length < maxActions) {
    const a = nextAIAction(state);
    applyAction(state, a);
    taken.push(a);
    if (a.type === 'endTurn') break;
  }
  if (state.winner === null && state.current === startPlayer) applyAction(state, { type: 'endTurn' });
  return taken;
}
