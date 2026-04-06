# Natac — Claude Code Guide

Settlers of Catan clone that runs on arbitrary polygon maps (pentagons, hexagons, heptagons). Single-file web app (`index.html`) backed by a JS module library under `src/`.

## Running the game

```bash
npm install
npm run serve   # http://localhost:8080 — open index.html
npm test        # unit tests (map generation / validation)
```

## Architecture

```
index.html          # Entire UI: canvas rendering, game loop, AI execution
src/
  core/
    game.js         # createGame, validateAction, applyAction, collectResources
    ai.js           # PERSONALITY_WEIGHTS, shouldAcceptTrade, getAIBuildingPriority
                    #   (these exports exist but are NOT imported by index.html —
                    #    the UI has its own inline AI logic)
    robber.js       # Robber / seven mechanics
    trade.js        # Trade proposal lifecycle
    military.js     # Optional military mode (knights, wagons, fleets)
    utils.js        # generateId, SeededRandom
  map/
    index.js        # generateMap() entry point
    mapgenBridge.js # Converts visualization data → MapData; assignResourcesAndDice
    hexGenerator.js # Hex grid builder
    standardBoard.js
    delaunayGenerator.js
    validator.js    # validateMap, getAdjacentNodes, findEdge
  models/
    types.js        # Resource enum, BUILDING_COSTS, TileShape
  api/
    index.js
mapgen.js           # window.generateMapData — visualization-layer map generator
```

## Key data structures

```js
// Tile
{ id, shape, polygonPoints, resource, diceNumber, nodes[], edges[], robberPresent }

// Node (vertex / intersection)
{ id, location: [x,y], tiles: [tileId,...], occupant: { playerId, type } | null }

// Edge
{ id, nodeA, nodeB, roadOwner: playerId | null }
```

`node.tiles` is the canonical list of adjacent tile IDs (1–3 entries).

## Game actions (strings passed to `applyAction`)

| Action | Phase | Payload |
|---|---|---|
| `placeSettlement` | setup + main | `{ nodeId }` |
| `placeRoad` | setup + main | `{ edgeId }` |
| `upgradeToCity` | main | `{ nodeId }` |
| `buyDevelopmentCard` | main | — |
| `createTradeProposal` | main | `{ targetId, offering, requesting }` |
| `acceptTradeProposal` | main | `{ tradeId }` |
| `executeTrade` | main | `{ tradeId }` |
| `endTurn` | main | — |

Always call `validateAction` before `applyAction` — it returns `{ ok, reason }`.

## AI system (all in `index.html`)

### Personalities (defined once, shared across games)

| Name | Favorite resource | `tradeAcceptanceThreshold` | `tradePropensity` |
|---|---|---|---|
| balanced | wheat | 0.5 | 0.3 |
| aggressive | ore | 0.3 | 0.5 |
| diplomatic | sheep | 0.7 | 0.7 |
| conservative | brick | 0.8 | 0.1 |

Each personality has `resourceWeights` (1.4× on favorite, 1.0× on others).

### Per-player random traits (assigned on game start)

- `cityBias` — `Math.random()` in [0, 1]. High = prefers upgrading to cities; low = prefers expanding with new settlements.

### AI turn flow

**Setup phase:** place settlement on highest dot-score vertex → place road randomly.

**Main phase:**
1. Process pending trade responses (weighted acceptance via `evaluateTradeForAI`).
2. Maybe propose a trade (biased toward requesting favorite resource when missing).
3. Try to build: roll against `cityBias` to decide city vs. settlement, fall back to the other if invalid. Settlement placement uses dot-score ranking.
4. End turn.

### Dot-score formula

```js
dotScore(diceNumber) = 6 - Math.abs(7 - diceNumber)
// 6 or 8 → 5 dots (highest),  2 or 12 → 1 dot (lowest)
```

Vertex score = sum of dot scores for adjacent tiles (desert / null diceNumber = 0).

## Rendering notes (`index.html` ~line 1184)

- Canvas 2D, zoom-aware scaling: `iz = 1 / zoom`.
- Coins: white circle radius `9*iz`, number shifted up `2*iz`, dots row at `+3.5*iz`.
- 6 and 8 render in red (`#c00`); all others in black.
- Dot spacing: `2.6*iz`, dot radius: `1.0*iz`.

## What `src/core/ai.js` is NOT used for

The exports in `ai.js` (`shouldAcceptTrade`, `getAIBuildingPriority`, etc.) reference `player.aiPersonality` which is never set on player objects. These functions are dead code relative to the running UI. The UI's inline AI is the actual implementation. If you refactor AI logic, work in `index.html` or wire up `ai.js` properly.

## Known issues

- `src/core/ai.js` exports are unused by the UI (see above).
- Delaunay map generator may fall back to hex if validation fails.
- AI does not yet build roads in the main phase.
- No win condition check is implemented yet.
