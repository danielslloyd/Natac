# Catan Clone — Specification & Implementation Notes

> Purpose: provide a single-file markdown spec that can be passed to a coding agent to implement a flexible, rule-configurable clone of Settlers of Catan. The implementation must default to the standard hex map, but all game logic must run on an arbitrary tiling of 5/6/7-sided polygons (or mixture), with the invariant that every **vertex/node** is adjacent to exactly **three** tiles.

---

## Table of contents

1. Goals & non-goals
2. High-level architecture
3. Core game entities & data models
4. Map constraints and validation rules
5. Map generation (default regular hex + modular irregular)
6. Setup rules (placement, resource distribution)
7. Turn flow & actions
8. Building & trading rules
9. Special mechanics: robber & enhanced knights
10. APIs / function signatures for the coding agent
11. Tests & edge cases
12. TODOs / extension points

---

## 1. Goals & non-goals

**Primary goals**
- Implement a rule-flexible Catan clone where the *same game logic* works on any suitable polygonal tiling (tiles with 5/6/7 sides allowed), as long as each node borders exactly 3 tiles.
- Default map: standard Catan hex layout (the usual 19-hex arrangement). This must be a built-in generator.
- Provide a modular "enhanced" map generator producing irregular polygons; keep it pluggable so map-generation strategies can be swapped or tuned.
- Implement standard building and resource rules (settlement, city, roads, resource distribution, robber) and the described enhanced knight behavior.
- Keep the domain model and algorithms implementation-friendly for a coding agent (clear function signatures, validation checks, and test scenarios).

**Non-goals (for first pass)**
- Full UI — only necessary state and event hooks for a UI/engine to consume.
- Networked multiplayer stack — define serializable actions and state so a network layer can be added later.
- Complex AI — provide hooks and a simple example bot, not a production AI.

---

## 2. High-level architecture

- `core/` — rules engine, game loop, validators, action dispatcher
- `map/` — map generators (regular hex generator + irregular generator interface + sample irregular implementation), map validators
- `models/` — data models (Tile, Node, Edge, Player, Bank, GameState)
- `api/` — function-level API that the coding agent should implement and export (game creation, action application, query endpoints)
- `tests/` — unit tests and integration tests (map validation, game start, sample turns, enhanced knight tests)

Prefer an MV* structure and separate pure logic from I/O.

---

## 3. Core game entities & data models

Use serializable plain objects (JSON-friendly). Below are canonical TypeScript-like interfaces (the coding agent can adapt to language of choice).

```ts
// Unique identifiers are strings (uuid or deterministic id)
type ID = string;

enum Resource { ORE = 'ore', SHEEP = 'sheep', WOOD = 'wood', BRICK = 'brick', WHEAT = 'wheat', DESERT = 'desert' }

enum TileShape { PENTAGON = 5, HEXAGON = 6, HEPTAGON = 7 }

interface Tile {
  id: ID;
  shape: TileShape; // 5/6/7 etc.
  polygonPoints?: [number,number][]; // optional for geometry/visual
  resource: Resource;
  diceNumber?: number | null; // 2..12 except 7; null for desert
  edges: ID[]; // edge IDs making up tile polygon
  nodes: ID[]; // vertex/node IDs in clockwise order
  robberPresent?: boolean; // true if robber on this tile
}

interface Node { // vertex
  id: ID;
  location?: [number,number]; // optional for coordinate-based maps
  tiles: ID[]; // must be length == 3 (invariant)
  occupant?: { playerId: ID; type: 'settlement' | 'city' } | null;
}

interface Edge {
  id: ID;
  nodeA: ID;
  nodeB: ID;
  tileLeft?: ID | null; // optional references to adjacent tiles
  tileRight?: ID | null;
  roadOwner?: ID | null; // playerId or null
}

interface Player {
  id: ID;
  name: string;
  color?: string;
  resources: Record<Resource, number>;
  roads: ID[]; // edge IDs owned
  settlements: ID[]; // node IDs
  cities: ID[]; // node IDs
  knights: ID[]; // knights placed (if using knights)
  victoryPoints: number;
  // other stats: longestRoadProgress, largestArmyCount etc.
}

interface Knight {
  id: ID;
  ownerId: ID;
  nodeId?: ID; // optional if knight placed at node
  active: boolean;
}

interface GameState {
  id: ID;
  players: Player[];
  bank: { [k in Resource]: number };
  tiles: Tile[];
  nodes: Node[];
  edges: Edge[];
  turnOrder: ID[];
  currentPlayerIdx: number;
  phase: 'setup' | 'main' | 'end';
  diceHistory: number[];
  seed?: string | number; // for deterministic map generation
  options: GameOptions;
}

interface GameOptions {
  mapType: 'regular' | 'enhanced';
  allowRobberOnDesertOnly?: boolean; // toggle
  enhancedKnights?: boolean; // key option for the special rule
  maxPlayers?: number;
}
```

**Important invariants & validation**
- Every `Node.tiles.length === 3` (mandatory requirement from the user).
- Node adjacency must be consistent with `Edge.nodeA/B` and `Tile.nodes` lists.
- No two settlements adjacent: when placing, ensure neighboring nodes (those that share an edge) are empty.

---

## 4. Map constraints and validation rules

The map generator must produce a map satisfying:

1. **Vertex degree invariant** — each node is adjacent to exactly three tiles. (This ensures the standard resource distribution rule "a node collects from its three bordering tiles" stays valid.)
2. **Planarity & connectivity** — graph of tiles/nodes/edges should be connected and planar.
3. **Edge/Node consistency** — each edge references two nodes; each tile references its edges and nodes; each node references exactly three tiles.
4. **Border handling** — border nodes/edges are allowed (i.e., nodes on the outer boundary may have fewer adjacent nodes), but still must have exactly 3 adjacent tiles per the invariant (meaning the tiling must be constructed to satisfy that). Practically: the outer boundary hex pattern will satisfy this; the irregular generator must ensure it too.

Provide `validateMap(map)` that runs all consistency checks and returns an array of errors (empty if valid).

**Note on feasibility**: arbitrary 5/6/7-sided polygons combined in a tiling with vertex degree 3 is feasible but nontrivial. Keep the irregular generator modular and include robust validation after generation. If a generated map violates the `node.tiles.length === 3` invariant, the generator must either fix the tiling or discard and retry.

---

## 5. Map generation

Expose two built-in generators plus a generator interface for swapping implementations.

```ts
interface MapGeneratorParams {
  seed?: string | number;
  targetTileCount?: number;
  allowedShapes?: TileShape[]; // e.g. [5,6,7]
  irregularity?: number; // 0..1 how irregular
  boundingRadius?: number; // visual/layout parameter
}

interface MapGenerator {
  generate(params: MapGeneratorParams): { tiles: Tile[]; nodes: Node[]; edges: Edge[] };
}
```

### 5.1 Regular hex generator (default)
- Provide `generateRegularHex(radius = 2)` which creates the classic Catan board (radius 2 hex grid producing 19 tiles). Implementation notes:
  - Use axial coordinates (q, r) for hex grid.
  - Compute node positions from hex corners and deduplicate nodes by coordinate with epsilon.
  - Assign tiles their neighbor relationships, nodes, and edges.
  - Assign the standard resource distribution (19 resources; include desert) and standard dice numbers (2–12 excluding 7) using the classic layout or a standard randomized order.

### 5.2 Irregular/enhanced generator (modular)
- Provide `generateIrregular(params)` which:
  1. Starts from a base lattice (hex or Voronoi seedpoints) sized to cover target tileCount.
  2. Perturbs vertex positions by `irregularity` factor (a small random displacement proportional to tile size).
  3. Use constrained Voronoi / clip to bounding polygon to obtain mostly 5/6/7-sided polygons.
  4. Post-process to **merge/split** cells if needed to ensure every vertex belongs to exactly 3 tiles. When necessary, do local repairs (merge tiny polygons, retriangulate) until validator is satisfied or until retry limit.
  5. Output tiles/nodes/edges with consistent references.

**Modularity**: Keep the irregular generation code as a separate class/module; accept callbacks for heuristics (e.g., `mergeIfTooSmall(cell)`, `splitIfTooComplex(cell)`) so you can tweak behavior.

**Determinism**: All generators must accept a `seed` to produce deterministic maps for testing.

---

## 6. Setup rules

- Player count: support 3–4 players by default; design to support 2–6 if desired.
- Initial placement: standard 2-phase clockwise+counter-clockwise placement. Must use the `validatePlacement(nodeId, playerId)` function to ensure the distance rule (no adjacent settlements).
- After placement, initial resource awards for second settlement: give the owning player 1 copy of each resource from tiles adjacent to that second settlement (as in classic Catan) — use tile.resource.
- Dice token placement: assign dice numbers to tiles (2..12 excluding 7) per rules or randomized distribution; allow option to use classic randomized token placement or fully random.

---

## 7. Turn flow & actions

High-level phases:
1. `startTurn(player)` — roll dice
   - If roll != 7: for each tile with rolled number, give resources to players who own settlements/cities adjacent to that tile (settlement = 1 resource, city = 2). Knights that act as blockers do not block the knight owner but block other players from collecting from that tile (enhanced option).
   - If roll == 7: robber activated — follow robber rules (move robber, steal resource, or skip if no target).
2. `mainPhase(player)` — player may perform any number of legal actions (build road, build settlement, upgrade to city, play development card including knight, trade, buy development card) as long as resource costs and placement rules are satisfied.
3. `endTurn(player)` — advance `currentPlayerIdx`.

**Action dispatch**
- All actions must be validated with a `validateAction(gameState, action)` which returns success/failure and reason.
- Actions are pure and result in a new `GameState` snapshot (functional style preferred) or an applied patch transaction.

**Resource distribution algorithm**
- For each tile T with diceNumber == roll:
  - If `robberPresent` on T: normally no resources are produced from T.
  - Enhanced knights: if there's a knight on one of the nodes of T that belongs to player Pk and the knight is in "blocking" state, block resource distribution to players ≠ Pk but allow Pk to collect.

---

## 8. Building & trading rules

Follow classical Catan costs and rules (can be parameterized). At minimum implement:

- Costs: Road(1 brick + 1 wood), Settlement(1 brick + 1 wood + 1 sheep + 1 wheat), City(2 wheat + 3 ore), DevCard(1 sheep + 1 wheat + 1 ore).
- Road placement: must connect to player's existing road/settlement/city; cannot place where occupied.
- Settlement placement: node must be empty; all adjacent nodes must be empty (distance rule); must be connected to player's road unless in the initial placement phase.
- City upgrade: node must have player's settlement to upgrade.
- Trading: bank trade (e.g., 4:1 default) and ports configurable.

---

## 9. Special mechanics: robber & enhanced knights

**Classic robber**
- When dice roll 7: all players with >7 resource cards must discard half (rounded down).
- The active player moves robber to a tile (cannot remain if optional rules prevent), and may steal one resource from an adjacent player.
- While robber is on a tile, that tile yields no resources.

**Enhanced knight behavior (as requested)**
- When a player plays a knight and displaces the robber from a tile `T` (i.e., drives the robber off T and places it somewhere else), **the knight remains on the board** at the location of the tile/node (decide whether knight sits on a node or tile; pick **node** to reuse node adjacency invariants).
- The knight becomes a **player-specific blocker**:
  - It blocks resource collection from tiles adjacent to the knight's node for *other players*.
  - The knight's owner still collects from those tiles as normal.
  - Knights can be attacked/removed by other knights? (Design choice: for first pass, other players can play knights to displace the knight — when a knight is displaced, it is moved/removed per game rules. Provide hooks so you can change this later.)

Implementation details:
- Model the knight as a game piece with `ownerId` and `nodeId`.
- During resource distribution, for a tile `T`, compute `blockingKnight = findKnightBlockingTile(T)` which scans all knights on nodes adjacent to T. If any blocking knights exist owned by players other than the resource-collecting player, then the resource award is suppressed for that player.
- Provide configuration `knightBlockingPolicy` with possible values `['ownerOnly', 'ownerPreferred', 'disabled']` to allow future tuning.

---

## 10. APIs / function signatures for coding agent

Provide these top-level functions; coding agent should implement and export them.

```ts
// Game creation
function createGame(options: GameOptions, players: Player[], seed?: string | number): GameState;

// Map generation
function generateMap(params: MapGeneratorParams): { tiles, nodes, edges };

// Map validation
function validateMap(tiles, nodes, edges): { valid: boolean; errors: string[] };

// Action validation + application
type Action = { type: string; payload: any; playerId: ID };
function validateAction(gameState: GameState, action: Action): { ok: boolean; reason?: string };
function applyAction(gameState: GameState, action: Action): GameState; // returns new state

// Helpers
function getLegalBuildLocations(gameState: GameState, playerId: ID): { roads: ID[]; settlements: ID[] };
function rollDice(seedless?: boolean): number; // or allow passing a seed for determinism

// Testing helpers
function forceDiceRoll(gameState: GameState, roll: number): GameState;
```

Also expose more granular helpers like `collectResources(gameState, roll)`, `moveRobber`, `playKnight`, `calculateLongestRoad`, `calculateLargestArmy`.

---

## 11. Tests & edge cases

### Unit tests (high priority)
1. **Map validation**: run `validateMap` on default `generateRegularHex(2)` — expect success.
2. **Node-degree invariant**: generate many irregular maps with different seeds and assert `node.tiles.length === 3` for all nodes or failure report.
3. **Initial placement rules**: disallow adjacent settlements; ensure proper resource grants after second placement.
4. **Resource production**: simulate roll for a tile and assert players collect correct resources; ensure robber blocks production.
5. **Enhanced knight**: place a knight on node adjacent to a tile T, simulate roll for T, verify knight owner collects while other players do not.
6. **Build validations**: can't build road where another player's road exists; can't build settlement without connection unless setup phase.

### Integration tests (scenarios)
- Play through a scripted 12-turn game including trading and at least one knight play in enhanced mode; compare expected resources and victory points.

### Stress tests
- Generate 1000 irregular maps with varying seeds and confirm either validator pass or generator retries with deterministic behavior.

---

## 12. TODOs / extension points
- Add ports and 2:1 trades in map generation by placing harbor nodes on the coast.
- Add Development Cards deck and cards other than knights.
- Implement network sync and an authoritative server state machine.
- UI hooks: event emitter for state changes, diffs/patches for UI animation.
- AI agent: create a simple heuristic bot to test playing.

---

## Example JSON snippets

**Minimal Tile example**:

```json
{
  "id": "tile-0",
  "shape": 6,
  "resource": "wood",
  "diceNumber": 8,
  "nodes": ["n0","n1","n2","n3","n4","n5"],
  "edges": ["e0","e1","e2","e3","e4","e5"]
}
```

**Minimal Node example**:

```json
{
  "id": "n0",
  "tiles": ["tile-0","tile-1","tile-5"],
  "occupant": null
}
```

---

## Final notes for the coding agent
- Keep map generation deterministic and pluggable.
- Make `validateMap` strict: the project requirement that *each node borders exactly three tiles* is central — fail fast if violated.
- Write small pure functions and unit tests for them.
- Avoid hard-coding hex-specific logic in the rules engine. The rules engine should operate on `tiles/nodes/edges` abstractly.


---

_End of specification._

