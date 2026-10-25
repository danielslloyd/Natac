# Natac: Blitz — Deck-Building WW2 Conquest

A standalone game mode modelled on *The Quest for El Dorado*, reskinned for
WW2. In El Dorado you race to a finish line; here two armies start at opposing
HQs and try to conquer each other. Your units move and fight only as far as
the cards in your hand let them.

- **Play:** `npm run serve` → `http://localhost:8080/blitz.html`
- **Engine:** [`src/blitz/engine.js`](./src/blitz/engine.js): pure logic, no DOM
- **AI:** [`src/blitz/ai.js`](./src/blitz/ai.js): `nextAIAction(state)` / `playAITurn(state)`
- **Tests:** [`src/tests/blitz.test.js`](./src/tests/blitz.test.js)

Each seat can be a human or the AI (hotseat, vs AI, or AI vs AI).

## Maps

The rules run on a tile graph, so both map types play the same way:

| Map | How it is built |
|---|---|
| **Hex** | Regular pointy-top hex grid (~131 tiles) |
| **Poly** | Voronoi cells over a jittered hex lattice, which gives mixed 5/6/7-sided tiles |

Both are **point-symmetric** about the centre, so terrain, depots and HQs mirror
exactly and neither side gets a better board. Distances and ranges are counted
in tile hops. Each board has 2 HQs (west/east) and 5 neutral supply depots.

## Cards (the El Dorado layer)

Every card has a **type** and a **value**. Playing a card adds its value to
your pool of that type for the turn. Unused pool points are lost at the end of
the turn.

| Type | Spent on |
|---|---|
| 🥫 Rations | Movement points for **infantry** |
| ⛽ Fuel | Movement points for **armor, artillery and aircraft** |
| 💥 Ammo | Attacks (each unit type has an ammo cost per attack) |
| 💰 Funds | Buying from the shared market |

- **Starting deck (8):** 2× Rations 1, 2× Fuel 1, 2× Ammo 1, 2× Funds 1.
- **Hand:** draw up to 4, plus 1 per depot you hold (max 6). Unplayed cards stay
  in your hand, and you can discard any of them to cycle your deck.
- **Market:** you may buy **one** card per turn. Funds and wild cards pay full
  value; any other card given up as payment counts as ½. Bought cards go to
  your discard pile.
- **Card kinds:** bigger resource cards, wild cards (Quartermaster,
  Logistics Corps), draw/trash cards (Recon Flight, Staff Officer,
  Reorganization), and single-use **reinforcement** cards that deploy a new
  unit at your HQ. Single-use cards (1×) leave the game once played.

## Units

| Unit | HP | Atk/Def | Moves (pool) | Range | Ammo/attack | Strengths | Weaknesses |
|---|---|---|---|---|---|---|---|
| 🪖 Infantry | 10 | 4/4 | ≤3 (🥫) | 1 | 1 | Big cover bonus in forest, hills and towns; only ground unit that can shoot at aircraft; captures | Badly outmatched by armor in the open |
| 🛡 Armor | 12 | 6/5 | ≤5 (⛽) | 1 | 1 | Fast, hits hard in open ground; captures | Slowed and blunted (×0.6) in forest and towns, can't enter mountains, can't hit aircraft |
| 🎯 Artillery | 8 | 6/2 | ≤2 (⛽) | 2–3 | 2 | Fires without taking return fire | Can't hit adjacent units, fragile, can't capture |
| ✈ Air Wing | 8 | 5/3 | ≤6 (⛽) | 1 | 1 | Flies over any terrain and any units; wrecks armor and artillery | Must end within 4 tiles of an airfield (your HQ or a held depot) or loses 4 HP per turn; can't capture |

**Matchup multipliers** (attacker → defender):

|  | Inf | Armor | Art | Air |
|---|---|---|---|---|
| **Inf** | 1.0 | 0.6 | 1.3 | 0.6 |
| **Armor** | 1.4 | 1.0 | 1.5 | — |
| **Art** | 1.3 | 0.8 | 1.0 | — |
| **Air** | 0.8 | 1.6 | 1.5 | 1.0 |

## Terrain (movement cost: foot / tracks / air)

| Terrain | Cost | Notes |
|---|---|---|
| Plains | 1 / 1 / 1 | Open ground, no cover |
| Forest | 1 / 2 / 1 | Infantry +50% defence; armor ×0.6, air ×0.7 attacking into it |
| Hills | 2 / 2 / 1 | Infantry +40% defence |
| Town | 1 / 2 / 1 | Infantry +60% defence; armor ×0.6 attacking into it. Depots and HQs are towns |
| Marsh | 2 / 3 / 1 | |
| Mountain | 3 / ✕ / 1 | Impassable to vehicles |
| Water | ✕ / ✕ / 1 | Aircraft can fly over it but can't end a move there |

A unit on its own HQ gets a further +30% defence.

## Combat

Combat is deterministic, with no dice (El Dorado has none either), and the UI
shows a damage preview before you commit.

```
attack  = atk × matchup × terrainAttackMod × (0.5 + 0.5·hp/maxHp)
defence = def × (1 + terrainBonus [+ HQ bonus]) × (0.5 + 0.5·hp/maxHp)
damage  = max(1, round(4 × attack / defence))
```

If the defender survives and can target the attacker at that distance, it
fires back with a base of 2.5 instead of 4. Each unit attacks once per turn
and can't move after attacking. Ground units pass through friendly units but
not enemy ones.

## Winning

- Move an **infantry or armor** unit onto the enemy HQ, **or**
- destroy every enemy unit.
- After 40 rounds, the player holding more depots wins; if that is tied, the
  higher total unit HP wins.

Units heal 2 HP at the start of your turn while standing on your HQ or a depot
you hold.
