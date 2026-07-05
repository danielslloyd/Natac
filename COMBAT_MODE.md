# Natac: War — Combat Game Mode

A **completely separate game mode** from the Catan settlement game. It is a
Civ-V-inspired hex-tactics game with an era-based **supply-line** layer that
governs every unit on the map.

- **Play it:** open [`combat.html`](./combat.html) (run `npm run serve`, then
  browse to `http://localhost:8080/combat.html`). A link also sits in the
  header of the main settlement game (`index.html`).
- **Engine:** [`src/combat/engine.js`](./src/combat/engine.js) — pure logic, no
  DOM, unit-tested in [`src/tests/combat.test.js`](./src/tests/combat.test.js).
- **UI:** `combat.html` — a standalone canvas UI that imports the engine.

It shares nothing with the settlement game's turn logic; it only reuses the hex
math and seeded RNG in `src/core/utils.js`.

## The three eras of combat

Each era escalates the logistics burden. You pick one when starting a game.

| Era | Supplies needed | New capability |
|---|---|---|
| **Classical** | 🟢 Food | Legions, archers, galleys |
| **Napoleonic** | 🟢 Food · 🔴 Ammo | Muskets, cavalry, cannon, frigates |
| **World War II** | 🟢 Food · 🔴 Ammo · 🟡 Fuel | Tanks, artillery, destroyers, **air units** |

What each resource is spent on:

- **Food** — consumed **constantly**: every unit eats every turn, in every era.
- **Ammunition** — consumed by **combat**: each attack spends ammo
  (Napoleonic + WW2). No ammo ⇒ the unit cannot fire.
- **Fuel** — consumed by **movement**: every hex a unit moves burns fuel
  (WW2 only). No fuel ⇒ the unit cannot move.

All three are stockpiled per-player and produced by your cities each turn. A
fourth resource, **production** (⬢), is used only to recruit new units and is
independent of the supply system.

## Supply lines (the core mechanic)

Every resource a unit consumes is delivered along a **supply line** that traces
back through friendly territory to one of your **cities**. Supply lines have a
**length-based cost**:

```
supply cost multiplier = 1 + (distance in hexes) × 0.25
```

So a unit sitting on its capital (distance 0) is supplied at ×1.0, while a unit
4 hexes out along the line pays ×2.0 for the same food / ammo / fuel. Push an
army deep into enemy land and it becomes ruinously expensive to keep fed and
armed — exactly the historical tyranny of logistics.

- Supply is traced by a breadth-first search over passable tiles (land supply
  over land, sea supply from coastal cities over water).
- **Enemy units sever supply lines** — an enemy standing on a tile blocks
  supply from flowing through it.
- Each era has a **maximum supply range** (Classical 4, Napoleonic 6, WW2 8
  hexes). Beyond it, or with the line cut, a unit is **out of supply**:
  - it **starves** — takes attrition (HP loss) every turn,
  - it fights at **half strength**,
  - in WW2 it **cannot move** (no fuel reaches it) and **cannot attack** (no
    ammo reaches it).

Toggle **"Show supply range overlay"** in-game to shade tiles by supply
distance from your cities.

## Units, movement and domains

Land and sea units move **distinctly**:

- **Land units** move only over land (plains cost 1, forest/hills cost 2);
  mountains and water are impassable to them.
- **Sea units** move only over water.
- Terrain also grants **defensive bonuses** (forest/hills +25%), and cities give
  a garrison bonus to a unit standing on them.

**Air units (WW2 only)** work differently and have **distinct bases**:

- Each aircraft is stationed at a friendly **city** (its base) and is supplied
  directly by that base.
- It **sorties** to strike any enemy within its range of the base (Fighter 5,
  Bomber 8 hexes), spending fuel + ammo, and takes no return fire from ground
  targets (Fighter-vs-Fighter dogfights are mutual).
- It can **rebase** to another friendly city within range, which uses its turn.

## Combat

Civ-V-style strength combat:

- **Melee** units attack an adjacent tile and take return damage; if the
  defender dies, the attacker advances into the tile.
- **Ranged** units (archers, cannon, artillery, ships, aircraft) strike from a
  distance and take no return fire.
- Damage scales with the strength ratio and unit HP, with a random factor.
- **Cities** have HP and a garrison strength. Bombard a city to break its HP
  (it will not repair while besieged), then move a **melee land unit** onto it
  to **capture** it. Captured cities join your supply network.

## Winning

Capture every enemy **capital**. The last player holding a capital wins.

## Action / API reference (engine)

The engine mutates a `state` object in place and returns `{ ok, reason, ... }`
status objects. Key exports from `src/combat/engine.js`:

```js
createCombatGame({ era, playerNames, aiPlayers, radius, seed })  // -> state

reachableTiles(state, unit)          // Map<tileKey, {cost, from}>
canMove(state, unit, toKey) / moveUnit(state, unitId, toKey)
attackableTargets(state, unit)       // [{ tileKey, kind, distance }]
canAttack(state, unit, targetKey) / attack(state, attackerId, targetKey)
rebaseTargets(state, unit) / rebaseAir(state, unitId, cityKey)   // air units

recruitableTypes(state)              // unit catalog for the current era
recruitTiles(state, playerId, typeKey)
canRecruit(...) / recruit(state, playerId, typeKey, atKey)

refreshSupply(state, playerId)       // recompute supply for a player's units
supplyDistanceMap(state, playerId, domain)   // Map<tileKey, distance>
supplyMultiplier(unit)               // 1 + distance × 0.25 (∞ if cut off)
runUpkeep(state, playerId)           // city production + food upkeep + attrition

endTurn(state)                       // -> { player, upkeep, winner }
runAITurn(state, playerId)           // full AI turn
checkWinner(state)                   // -> winning playerId | null
```

## Implementation notes

- Hex grid uses axial coordinates via the helpers in `src/core/utils.js`
  (`hexSpiral`, `hexRing`, `hexNeighbors`, `hexDistance`).
- Capitals are placed on the outer ring, evenly spaced, and their immediate
  surroundings are cleared to guarantee they can deploy units and project
  supply.
- The AI is intentionally simple: reinforce at home, advance on the nearest
  enemy/neutral city, and attack when able. It is a credible opponent for a
  human, not a master strategist.
