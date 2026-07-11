// hexwar/core/engine.js
// The common combat framework. A Game = TileMap + Ruleset + units + turn loop.
//
// Design goals:
//   * headless-first: no DOM anywhere, deterministic under a seed
//   * AI-ready: legalActions() enumerates every legal action for the player
//     to move, applyAction() advances the state, observe() returns plain JSON
//   * variant-agnostic: everything terrain/geometry specific lives in the
//     Ruleset object (see contract below)
//
// ── Ruleset contract ────────────────────────────────────────────────────────
// {
//   key, title, hint,                    // strings; hint = verbose on-page help
//   options: { ... }                     // defaults, merged with createGame opts
//   buildMap(opts) -> TileMap            // geometry + terrain in tile.props
//   setup(game)                          // place starting units / objectives
//   unitTypes: { key: { name, symbol, cls: 'melee'|'ranged',
//                       str, rangedStr?, range?, move, lines?, note } }
//   moveCost(game, unit, from, to) -> number|Infinity   // per step
//   lineCost?(game, unit, from, to) -> number           // secondary budget
//   lineBudget?(game, unit) -> number                   // per turn (hexiso)
//   attackRange(game, unit) -> int       // in tiles (hop distance)
//   canTarget?(game, unit, targetTile) -> { ok, reason }   // e.g. LOS
//   defenseModifier?(game, defender, attacker) -> multiplier
//   attackModifier?(game, attacker, defenderTile) -> multiplier
//   extraActions?(game, unit) -> [action]               // e.g. bridge, fortify
//   applyExtraAction?(game, unit, action) -> { ok, events }
//   onRoundStart?(game)                  // once per round (before player 0)
//   onTurnStart?(game, playerId)         // each player's refresh
//   victory?(game) -> playerId|'draw'|null   // besides elimination/score
// }
// ────────────────────────────────────────────────────────────────────────────

import { SeededRandom, clamp } from './util.js';

export const MAX_HP = 100;

export class Game {
  constructor({ ruleset, players = 2, seed = 1, options = {} }) {
    this.ruleset = ruleset;
    this.options = { maxRounds: 60, targetScore: 12, ...ruleset.options, ...options };
    this.seed = seed;
    this.rng = new SeededRandom(seed);
    this.map = ruleset.buildMap({ seed, ...this.options }, this);

    this.players = [];
    for (let i = 0; i < players; i++) {
      this.players.push({ id: i, name: `P${i + 1}`, score: 0, alive: true });
    }

    this.units = new Map();      // unitId -> unit
    this.unitsByTile = new Map();// tileId -> unitId
    this.nextUnitId = 1;

    this.round = 1;
    this.current = 0;            // player id whose turn it is
    this.over = false;
    this.winner = null;          // playerId | 'draw' | null
    this.log = [];
    this.props = {};             // variant-owned globals (water level, ...)

    ruleset.setup(this);
    if (ruleset.onRoundStart) ruleset.onRoundStart(this);
    this._refreshPlayer(this.current);
  }

  say(msg) {
    this.log.push(`[r${this.round} P${this.current + 1}] ${msg}`);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  // ── units ────────────────────────────────────────────────────────────────

  addUnit(owner, typeKey, tileId) {
    const type = this.ruleset.unitTypes[typeKey];
    if (!type) throw new Error(`unknown unit type ${typeKey}`);
    if (this.unitsByTile.has(tileId)) return null;
    const unit = {
      id: this.nextUnitId++,
      owner, type: typeKey,
      hp: MAX_HP,
      tile: tileId,
      movesLeft: 0, linesLeft: 0, attacksLeft: 0,
      fortified: false, acted: false
    };
    this.units.set(unit.id, unit);
    this.unitsByTile.set(tileId, unit.id);
    return unit;
  }

  unitType(unit) { return this.ruleset.unitTypes[unit.type]; }
  unitAt(tileId) {
    const id = this.unitsByTile.get(tileId);
    return id === undefined ? null : this.units.get(id);
  }
  unitsOf(playerId) {
    return [...this.units.values()].filter(u => u.owner === playerId);
  }

  removeUnit(unit) {
    this.units.delete(unit.id);
    if (this.unitsByTile.get(unit.tile) === unit.id) this.unitsByTile.delete(unit.tile);
  }

  placeUnit(unit, tileId) {
    if (this.unitsByTile.get(unit.tile) === unit.id) this.unitsByTile.delete(unit.tile);
    unit.tile = tileId;
    this.unitsByTile.set(tileId, unit.id);
  }

  /** Effective strength, HP-scaled (civ5-style). */
  effectiveStrength(unit, { ranged = false } = {}) {
    const t = this.unitType(unit);
    const base = ranged && t.rangedStr ? t.rangedStr : t.str;
    return base * (0.55 + 0.45 * unit.hp / MAX_HP);
  }

  // ── movement ─────────────────────────────────────────────────────────────

  /**
   * All tiles the unit can reach this turn, honoring the primary movement
   * budget and (if the ruleset defines one) the secondary "line" budget.
   * Pareto-label Dijkstra: a tile may be reachable cheaply in moves but
   * expensively in lines via one path, and vice versa via another.
   *
   * Returns Map<tileId, { cost, lines, path: [tileIds...] }>.
   */
  reachable(unit) {
    const rs = this.ruleset;
    const hasLines = !!rs.lineCost;
    const budgetMoves = unit.movesLeft;
    const budgetLines = hasLines ? unit.linesLeft : Infinity;

    const labels = new Map(); // tileId -> [{cost, lines, path}]
    const start = { tile: unit.tile, cost: 0, lines: 0, path: [unit.tile] };
    labels.set(unit.tile, [start]);
    const frontier = [start];

    const dominated = (list, cand) =>
      list.some(l => l.cost <= cand.cost && l.lines <= cand.lines);

    while (frontier.length) {
      // smallest (cost, lines) first — maps are small, linear scan is fine
      let bi = 0;
      for (let i = 1; i < frontier.length; i++) {
        const a = frontier[i], b = frontier[bi];
        if (a.cost < b.cost || (a.cost === b.cost && a.lines < b.lines)) bi = i;
      }
      const cur = frontier.splice(bi, 1)[0];

      for (const n of this.map.neighbors(cur.tile)) {
        const stepCost = rs.moveCost(this, unit, cur.tile, n);
        if (!isFinite(stepCost)) continue;
        const stepLines = hasLines ? rs.lineCost(this, unit, cur.tile, n) : 0;
        const cand = {
          tile: n,
          cost: cur.cost + stepCost,
          lines: cur.lines + stepLines,
          path: [...cur.path, n]
        };
        if (cand.cost > budgetMoves || cand.lines > budgetLines) continue;
        const occupant = this.unitAt(n);
        if (occupant && occupant.owner !== unit.owner) continue; // can't pass through enemies
        let list = labels.get(n);
        if (!list) { list = []; labels.set(n, list); }
        if (dominated(list, cand)) continue;
        // drop labels the candidate dominates
        for (let i = list.length - 1; i >= 0; i--) {
          if (cand.cost <= list[i].cost && cand.lines <= list[i].lines) list.splice(i, 1);
        }
        list.push(cand);
        frontier.push(cand);
      }
    }

    const out = new Map();
    for (const [tileId, list] of labels) {
      if (tileId === unit.tile) continue;
      if (this.unitsByTile.has(tileId)) continue; // may pass through friends, not stop on them
      let best = list[0];
      for (const l of list) if (l.cost < best.cost) best = l;
      out.set(tileId, { cost: best.cost, lines: best.lines, path: best.path });
    }
    return out;
  }

  // ── targeting ────────────────────────────────────────────────────────────

  /** Enemy-occupied tiles this unit can attack right now. */
  attackableTiles(unit) {
    if (unit.attacksLeft <= 0) return [];
    const range = this.ruleset.attackRange(this, unit);
    const dists = this.map.bfsFrom(unit.tile);
    const out = [];
    for (const [tileId, unitId] of this.unitsByTile) {
      const target = this.units.get(unitId);
      if (target.owner === unit.owner) continue;
      const d = dists[tileId];
      if (d === -1 || d > range) continue;
      const type = this.unitType(unit);
      if (type.cls === 'melee' && d > 1) continue;
      if (this.ruleset.canTarget) {
        const chk = this.ruleset.canTarget(this, unit, tileId);
        if (!chk.ok) continue;
      }
      out.push(tileId);
    }
    return out;
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /**
   * Every legal action for `playerId` (must be the current player).
   * Action shapes:
   *   { type: 'move',    unitId, to }
   *   { type: 'attack',  unitId, target }        // target = tileId
   *   { type: 'endTurn' }
   *   ...plus whatever ruleset.extraActions emits (must carry unitId).
   */
  legalActions(playerId) {
    if (this.over || playerId !== this.current) return [];
    const actions = [];
    for (const unit of this.unitsOf(playerId)) {
      if (unit.movesLeft > 0) {
        for (const [to] of this.reachable(unit)) {
          actions.push({ type: 'move', unitId: unit.id, to });
        }
      }
      for (const target of this.attackableTiles(unit)) {
        actions.push({ type: 'attack', unitId: unit.id, target });
      }
      if (this.ruleset.extraActions) {
        actions.push(...this.ruleset.extraActions(this, unit));
      }
    }
    actions.push({ type: 'endTurn' });
    return actions;
  }

  applyAction(action) {
    if (this.over) return { ok: false, reason: 'game over' };
    switch (action.type) {
      case 'endTurn': return this.endTurn();
      case 'move': return this._doMove(action);
      case 'attack': return this._doAttack(action);
      default: {
        const unit = this.units.get(action.unitId);
        if (!unit || unit.owner !== this.current) return { ok: false, reason: 'not your unit' };
        if (this.ruleset.applyExtraAction) {
          return this.ruleset.applyExtraAction(this, unit, action);
        }
        return { ok: false, reason: `unknown action ${action.type}` };
      }
    }
  }

  _doMove({ unitId, to }) {
    const unit = this.units.get(unitId);
    if (!unit || unit.owner !== this.current) return { ok: false, reason: 'not your unit' };
    const reach = this.reachable(unit);
    const entry = reach.get(to);
    if (!entry) return { ok: false, reason: 'unreachable' };
    this.placeUnit(unit, to);
    unit.movesLeft = Math.max(0, unit.movesLeft - entry.cost);
    if (this.ruleset.lineCost) unit.linesLeft = Math.max(0, unit.linesLeft - entry.lines);
    unit.fortified = false;
    unit.acted = true;
    if (this.ruleset.onUnitMoved) this.ruleset.onUnitMoved(this, unit, entry);
    return { ok: true, events: [{ kind: 'move', unitId, to, cost: entry.cost, lines: entry.lines }] };
  }

  _doAttack({ unitId, target }) {
    const unit = this.units.get(unitId);
    if (!unit || unit.owner !== this.current) return { ok: false, reason: 'not your unit' };
    if (!this.attackableTiles(unit).includes(target)) return { ok: false, reason: 'invalid target' };
    const defender = this.unitAt(target);
    const events = this.resolveCombat(unit, defender);
    unit.attacksLeft -= 1;
    unit.movesLeft = 0; // attacking ends the unit's turn
    unit.fortified = false;
    unit.acted = true;
    this._checkElimination();
    return { ok: true, events };
  }

  /** Civ5-flavored strength-ratio combat. */
  resolveCombat(attacker, defender) {
    const events = [];
    const rs = this.ruleset;
    const aType = this.unitType(attacker);
    const isRanged = aType.cls === 'ranged';

    let att = this.effectiveStrength(attacker, { ranged: isRanged });
    let def = this.effectiveStrength(defender);
    if (rs.attackModifier) att *= rs.attackModifier(this, attacker, defender.tile);
    if (rs.defenseModifier) def *= rs.defenseModifier(this, defender, attacker);
    if (defender.fortified) def *= 1.25;
    att = Math.max(att, 0.1); def = Math.max(def, 0.1);

    const roll = () => 0.85 + this.rng.next() * 0.3;
    const dmgTo = (num, den) => clamp(Math.round(26 * Math.pow(num / den, 1.15) * roll()), 5, 100);

    const dmgDef = dmgTo(att, def);
    defender.hp -= dmgDef;
    events.push({ kind: 'hit', attacker: attacker.id, defender: defender.id, dmg: dmgDef });
    this.say(`${aType.symbol} hits ${this.unitType(defender).symbol} for ${dmgDef}`);

    if (!isRanged && defender.hp > 0) {
      const dmgAtt = dmgTo(def, att);
      attacker.hp -= dmgAtt;
      events.push({ kind: 'counter', attacker: defender.id, defender: attacker.id, dmg: dmgAtt });
      this.say(`counterattack for ${dmgAtt}`);
    }

    if (defender.hp <= 0) {
      const deadTile = defender.tile;
      this.removeUnit(defender);
      events.push({ kind: 'death', unitId: defender.id });
      this.say(`${this.unitType(defender).symbol} destroyed`);
      if (!isRanged && attacker.hp > 0) {
        const stepCost = rs.moveCost(this, attacker, attacker.tile, deadTile);
        if (isFinite(stepCost)) {
          this.placeUnit(attacker, deadTile); // melee advances into the tile
          events.push({ kind: 'advance', unitId: attacker.id, to: deadTile });
        }
      }
    }
    if (attacker.hp <= 0) {
      this.removeUnit(attacker);
      events.push({ kind: 'death', unitId: attacker.id });
      this.say(`attacker destroyed by counterattack`);
    }
    return events;
  }

  // ── turn / round loop ────────────────────────────────────────────────────

  endTurn() {
    if (this.over) return { ok: false, reason: 'game over' };
    // healing: a unit that did nothing all turn recovers
    for (const u of this.unitsOf(this.current)) {
      if (!u.acted && u.hp < MAX_HP) u.hp = Math.min(MAX_HP, u.hp + 10);
    }
    // advance to next living player; wrapping past the end closes the round
    const prev = this.current;
    let next = prev;
    do { next = (next + 1) % this.players.length; } while (!this.players[next].alive);
    this.current = next;

    if (next <= prev) {
      this._endOfRound();
      if (this.over) return { ok: true, events: [{ kind: 'gameOver', winner: this.winner }] };
      this.round += 1;
      if (this.ruleset.onRoundStart) this.ruleset.onRoundStart(this);
    }
    this._refreshPlayer(this.current);
    this._checkElimination();
    return { ok: true, events: [{ kind: 'turn', player: this.current, round: this.round }] };
  }

  _refreshPlayer(playerId) {
    for (const u of this.unitsOf(playerId)) {
      const t = this.unitType(u);
      u.movesLeft = t.move;
      u.linesLeft = this.ruleset.lineBudget ? this.ruleset.lineBudget(this, u) : 0;
      u.attacksLeft = 1;
      u.acted = false;
    }
    if (this.ruleset.onTurnStart) this.ruleset.onTurnStart(this, playerId);
  }

  _endOfRound() {
    // objective scoring: any tile with props.objective scores for the player
    // whose unit stands on it at the end of the round
    for (const tile of this.map.tiles) {
      if (!tile.props.objective) continue;
      const holder = this.unitAt(tile.id);
      if (holder) this.players[holder.owner].score += 1;
    }
    const target = this.options.targetScore;
    const leaders = this.players.filter(p => p.alive && p.score >= target);
    if (leaders.length) {
      leaders.sort((a, b) => b.score - a.score);
      this._finish(leaders[0].id, `reached ${leaders[0].score} objective points`);
      return;
    }
    if (this.ruleset.victory) {
      const v = this.ruleset.victory(this);
      if (v !== null && v !== undefined) { this._finish(v, 'ruleset victory'); return; }
    }
    if (this.round >= this.options.maxRounds) {
      // decide by score, then by total remaining HP
      const alive = this.players.filter(p => p.alive);
      const hpOf = p => this.unitsOf(p.id).reduce((s, u) => s + u.hp, 0);
      alive.sort((a, b) => (b.score - a.score) || (hpOf(b) - hpOf(a)));
      if (alive.length >= 2 && alive[0].score === alive[1].score && hpOf(alive[0]) === hpOf(alive[1])) {
        this._finish('draw', 'round limit, dead even');
      } else {
        this._finish(alive[0].id, 'round limit — ahead on points/HP');
      }
    }
  }

  _checkElimination() {
    for (const p of this.players) {
      if (p.alive && this.unitsOf(p.id).length === 0) {
        p.alive = false;
        this.say(`P${p.id + 1} eliminated`);
      }
    }
    const alive = this.players.filter(p => p.alive);
    if (!this.over && alive.length === 1) this._finish(alive[0].id, 'last army standing');
    if (!this.over && alive.length === 0) this._finish('draw', 'mutual destruction');
  }

  _finish(winner, why) {
    this.over = true;
    this.winner = winner;
    this.say(`GAME OVER — ${winner === 'draw' ? 'draw' : 'P' + (winner + 1) + ' wins'} (${why})`);
  }

  // ── observation (for AIs / logging) ──────────────────────────────────────

  /** Static map description; fetch once per game. */
  describeMap() {
    return {
      kind: this.map.kind,
      tiles: this.map.tiles.map(t => ({
        id: t.id, center: t.center, neighbors: t.neighbors, props: t.props
      })),
      edgeProps: [...this.map.edgeProps.entries()]
    };
  }

  /** Full-information snapshot as plain JSON (no fog of war in v1). */
  observe() {
    return {
      variant: this.ruleset.key,
      round: this.round,
      current: this.current,
      over: this.over,
      winner: this.winner,
      props: this.props,
      players: this.players.map(p => ({ id: p.id, score: p.score, alive: p.alive })),
      units: [...this.units.values()].map(u => ({
        id: u.id, owner: u.owner, type: u.type, hp: u.hp, tile: u.tile,
        movesLeft: u.movesLeft, linesLeft: u.linesLeft, attacksLeft: u.attacksLeft,
        fortified: u.fortified
      }))
    };
  }
}
