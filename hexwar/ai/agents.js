// hexwar/ai/agents.js
// The AI plug-in surface. An agent is anything with:
//
//   chooseAction(game, playerId, legalActions) -> action
//
// The runner calls it repeatedly while it is the agent's turn; returning
// { type: 'endTurn' } (or any action whose application ends the turn) hands
// play over. Agents may inspect the full Game, or stick to game.observe() /
// game.describeMap() if they want to be model-friendly (pure JSON in,
// action out — the shape an RL policy would use).

import { SeededRandom } from '../core/util.js';

/** Uniform-random legal play. The baseline sparring partner. */
export class RandomAgent {
  constructor(seed = 1) { this.rng = new SeededRandom(seed * 977 + 11); }

  chooseAction(game, playerId, legalActions) {
    const active = legalActions.filter(a => a.type !== 'endTurn');
    // small chance to end early keeps games from meandering forever
    if (!active.length || this.rng.next() < 0.08) return { type: 'endTurn' };
    return active[this.rng.nextInt(0, active.length - 1)];
  }
}

/**
 * Greedy heuristic: take the best-ratio attack available, otherwise walk
 * toward objectives/enemies. Credible sparring partner, not a strategist.
 */
export class HeuristicAgent {
  constructor(seed = 1) { this.rng = new SeededRandom(seed * 613 + 29); }

  chooseAction(game, playerId, legalActions) {
    // 1) best attack by strength ratio
    const attacks = legalActions.filter(a => a.type === 'attack');
    let bestAttack = null, bestRatio = -Infinity;
    for (const a of attacks) {
      const unit = game.units.get(a.unitId);
      const target = game.unitAt(a.target);
      if (!unit || !target) continue;
      const ranged = game.unitType(unit).cls === 'ranged';
      const ratio = game.effectiveStrength(unit, { ranged }) / Math.max(1, game.effectiveStrength(target))
        + (ranged ? 0.5 : 0); // ranged attacks are free damage — prefer them
      if (ratio > bestRatio) { bestRatio = ratio; bestAttack = a; }
    }
    if (bestAttack && bestRatio > 0.75) return bestAttack;

    // 2) advance: for each unit with moves, pick the reachable tile that best
    //    closes distance to the nearest goal (objective first, then enemies)
    const goals = [];
    for (const t of game.map.tiles) {
      if (t.props.objective) {
        const holder = game.unitAt(t.id);
        if (!holder || holder.owner !== playerId) goals.push(t.id);
      }
    }
    for (const u of game.units.values()) if (u.owner !== playerId) goals.push(u.tile);
    if (!goals.length) return { type: 'endTurn' };

    const moves = legalActions.filter(a => a.type === 'move');
    let bestMove = null, bestGain = 0;
    for (const m of moves) {
      const unit = game.units.get(m.unitId);
      const distTo = tile => Math.min(...goals.map(g => {
        const d = game.map.bfsFrom(g)[tile];
        return d === -1 ? 1e9 : d;
      }));
      const gain = distTo(unit.tile) - distTo(m.to);
      // tiny jitter breaks ties so armies don't file into one lane
      const jitter = this.rng.next() * 0.1;
      if (gain + jitter > bestGain) { bestGain = gain + jitter; bestMove = m; }
    }
    if (bestMove) return bestMove;

    // 3) any leftover attack even at bad odds beats standing still
    if (bestAttack) return bestAttack;

    // 4) fortify whoever can (civ), then done
    const fortify = legalActions.find(a => a.type === 'fortify');
    if (fortify) return fortify;
    const bridge = legalActions.find(a => a.type === 'bridge');
    if (bridge) return bridge;

    return { type: 'endTurn' };
  }
}

export const AGENTS = {
  random: seed => new RandomAgent(seed),
  heuristic: seed => new HeuristicAgent(seed)
};

/**
 * Drives one player's whole turn with an agent. Hard cap on actions per turn
 * protects against buggy agents that never end their turn.
 */
export function playTurn(game, agent, { maxActionsPerTurn = 200 } = {}) {
  const playerId = game.current;
  for (let i = 0; i < maxActionsPerTurn; i++) {
    if (game.over || game.current !== playerId) return;
    const actions = game.legalActions(playerId);
    const action = agent.chooseAction(game, playerId, actions) || { type: 'endTurn' };
    const res = game.applyAction(action);
    if (!res.ok) {
      // an illegal choice forfeits the rest of the turn rather than looping
      game.applyAction({ type: 'endTurn' });
      return;
    }
    if (action.type === 'endTurn') return;
  }
  game.applyAction({ type: 'endTurn' });
}

/**
 * Full headless match. agents: array indexed by playerId.
 * Returns { winner, rounds, scores, log }.
 */
export function runMatch(game, agents, { maxSteps = 100000, onTurn = null } = {}) {
  let guard = 0;
  while (!game.over && guard++ < maxSteps) {
    const pid = game.current;
    playTurn(game, agents[pid]);
    if (onTurn) onTurn(game, pid);
    if (guard > 2 && game.current === pid && !game.over) {
      // safety: turn failed to advance (shouldn't happen)
      game.applyAction({ type: 'endTurn' });
    }
  }
  return {
    winner: game.winner,
    rounds: game.round,
    scores: game.players.map(p => p.score),
    unitsLeft: game.players.map(p => game.unitsOf(p.id).length),
    log: game.log
  };
}
