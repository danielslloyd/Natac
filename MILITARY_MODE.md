# Military Conquest Game Mode

This document describes the military conquest game mode for Natac, a Catan-like game with added military mechanics.

## Overview

The military mode adds strategic military elements including knights, supply wagons, and naval fleets. Players can use these units to control territory, block opponents' resources, and capture enemy settlements and cities.

## Enabling Military Mode

Enable military mode when creating a game:

```typescript
import { createGame } from './src/api/index.js';

const game = createGame(['Alice', 'Bob', 'Charlie'], {
  mapType: 'standard',
  militaryMode: true  // Enable military conquest mode
});
```

## Military Units

### Knights

**Cost**: 3 ore, 3 wheat, 3 sheep
**Maintenance**: 1 wheat, 1 sheep per turn
**Placement**: Deployed on land tiles
**Movement**: 1 tile per turn

Knights are the primary military units. They:
- Block resource production on their tile for all other players
- Can only block when supplied (connected to your settlements/cities via wagons or roads)
- Can be transported by fleets across water
- Are used to capture enemy settlements and cities

```typescript
import { purchaseMilitaryKnight } from './src/api/index.js';

// Purchase and deploy a knight on a tile
const result = purchaseMilitaryKnight(state, playerId, tileId);
```

### Wagons

**Cost**: 2 wood, 2 wheat
**Maintenance**: 1 wheat per turn
**Placement**: On edges (like roads)
**Repositioning**: 1 wagon per turn

Wagons create supply lines for knights:
- Connect settlements/cities to knights
- Knights must have a wagon/road chain to a settlement/city to be supplied
- One wagon can be repositioned to a different edge each turn
- Unsupplied knights cannot block production or contribute to captures

```typescript
import { placeWagon, repositionWagon } from './src/api/index.js';

// Place a wagon on an edge
const result = placeWagon(state, playerId, edgeId);

// Reposition a wagon to a different edge (once per turn)
const result = repositionWagon(state, playerId, wagonId, newEdgeId);
```

### Fleets

**Cost**: 3 wood, 3 sheep
**Maintenance**: 1 wood, 1 sheep per turn
**Placement**: On water tiles
**Movement**: 1 tile per turn
**Capacity**: Can carry 1 knight

Fleets enable naval transportation:
- Can only be placed on and move to water tiles
- Can load and unload knights from adjacent land tiles
- Knights carried by fleets cannot block production or capture settlements

```typescript
import { buildFleet, moveFleet, loadKnightOntoFleet, unloadKnightFromFleet } from './src/api/index.js';

// Build a fleet on a water tile
const result = buildFleet(state, playerId, waterTileId);

// Load a knight onto a fleet (knight must be on adjacent land tile)
const result = loadKnightOntoFleet(state, playerId, knightId, fleetId);

// Unload a knight from a fleet to an adjacent land tile
const result = unloadKnightFromFleet(state, playerId, fleetId, targetTileId);
```

## Movement System

Each turn, you can:
- Move each knight 1 tile (to an adjacent land tile)
- Move each fleet 1 tile (to an adjacent water tile)
- Reposition 1 wagon to a different edge

Movement flags are reset at the end of your turn.

```typescript
import { moveMilitaryKnight, moveFleet } from './src/api/index.js';

// Move a knight to an adjacent tile
const result = moveMilitaryKnight(state, playerId, knightId, targetTileId);

// Move a fleet to an adjacent water tile
const result = moveFleet(state, playerId, fleetId, targetTileId);
```

## Supply Chain System

Knights require supply to function:
- A supplied knight has a wagon/road chain connecting it to one of your settlements or cities
- The chain must connect to one of the vertices of the knight's tile
- Supply status is automatically updated when wagons are placed, repositioned, or removed
- Only supplied knights can:
  - Block resource production on their tile
  - Contribute to capturing settlements/cities

## Resource Blocking

Supplied knights block resource production:
- When a supplied knight occupies a tile, only the knight's owner collects resources from that tile
- All other players with settlements/cities on that tile receive nothing
- This functions similarly to the robber but affects the entire tile

## Capturing Settlements and Cities

Capture enemy structures by surrounding them with supplied knights:

**Settlements**: Require 3 consecutive turns of being surrounded
**Cities**: Require 6 consecutive turns of being surrounded

A settlement/city is "surrounded" when:
- All adjacent **land tiles** have supplied knights from the attacking player
- Water tiles are ignored for capture purposes
- If the attacker breaks the siege (removes a knight or loses supply), the counter resets

When captured:
- The structure transfers to the attacker
- Victory points transfer accordingly
- The structure type (settlement/city) remains unchanged

Capture progress is tracked automatically and updates at the end of each turn.

## Maintenance Costs

At the end of your turn, you must pay maintenance for all your military units:

| Unit | Per Turn Cost |
|------|---------------|
| Knight | 1 wheat, 1 sheep |
| Wagon | 1 wheat |
| Fleet | 1 wood, 1 sheep |

If you cannot afford maintenance, you cannot end your turn. Plan your economy carefully!

## Action Types

The military mode adds these action types to the game:

```typescript
// Purchase and placement
{ type: 'purchaseMilitaryKnight', playerId, payload: { tileId } }
{ type: 'placeWagon', playerId, payload: { edgeId } }
{ type: 'buildFleet', playerId, payload: { tileId } }

// Movement
{ type: 'moveMilitaryKnight', playerId, payload: { knightId, targetTileId } }
{ type: 'moveFleet', playerId, payload: { fleetId, targetTileId } }
{ type: 'repositionWagon', playerId, payload: { wagonId, newEdgeId } }

// Fleet operations
{ type: 'loadKnightOntoFleet', playerId, payload: { knightId, fleetId } }
{ type: 'unloadKnightFromFleet', playerId, payload: { fleetId, targetTileId } }
```

## Strategic Tips

1. **Early Economy**: Build up resource production before investing in military units - maintenance costs add up quickly
2. **Supply Lines**: Always ensure your knights are supplied. Unsupplied knights are useless
3. **Wagon Network**: Build a robust wagon network to maintain flexibility in knight positioning
4. **Naval Power**: Fleets are expensive but enable surprise attacks from unexpected angles
5. **Defensive Play**: Keep some knights near your own settlements to prevent captures
6. **Resource Denial**: Use knights to block opponents' most valuable tiles
7. **Timing Captures**: 3-6 turns is a long time - make sure you can hold the siege before committing

## Game State

Military mode adds these fields to the game state:

```typescript
interface GameState {
  // ... existing fields ...
  militaryKnights?: MilitaryKnight[];
  wagons?: Wagon[];
  fleets?: Fleet[];
  captureProgress?: CaptureProgress[];
}

interface Player {
  // ... existing fields ...
  militaryKnights?: ID[];
  wagons?: ID[];
  fleets?: ID[];
}
```

## Implementation Details

The military mode is implemented in:
- `/src/models/types.ts` - Data structures and constants
- `/src/core/military.ts` - Core military logic
- `/src/core/game.ts` - Integration with main game loop
- `/src/api/index.ts` - Public API exports

Key functions:
- `updateKnightSupplyStatus()` - Updates supply status for all knights
- `updateCaptureProgress()` - Tracks and resolves settlement/city captures
- `collectMaintenanceCosts()` - Collects per-turn maintenance fees
- `resetMovementFlags()` - Resets movement flags at turn end
