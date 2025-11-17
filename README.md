# Natac - Catan-like Game on Arbitrary Polygon Maps

A flexible, rule-configurable implementation of a Settlers of Catan-like board game that runs on arbitrary polygonal tilings, not just hexagons. The game supports standard Catan mechanics while allowing maps built from 5/6/7-sided polygons with the core constraint that every vertex touches exactly 3 tiles (for interior vertices).

## Features

### Map Generation

The game supports three map types:

1. **Standard Catan Map** - Classic 19-hex Catan board with standard resource distribution
2. **Expanded Hex Grid** - Larger hexagonal maps for extended gameplay
3. **Delaunay Polygon Map** (Experimental) - Organic-looking irregular polygons generated using the Delaunay-centroid algorithm

All map types maintain consistent game mechanics, with validation to ensure proper tile connectivity and vertex relationships.

### Game Mechanics

- **Setup Phase**: 2-round placement (forward and reverse order) with initial resource grants
- **Resource Production**: Dice-based resource distribution with settlement (1x) and city (2x) yields
- **Building System**:
  - Roads: Connect settlements and extend your network
  - Settlements: Basic structures worth 1 victory point
  - Cities: Upgraded settlements worth 2 victory points
- **Robber Mechanics**:
  - Activated on dice roll of 7
  - Players with >7 cards discard half
  - Blocks resource production on occupied tiles
- **Enhanced Knights** (Optional): Knights remain on the board and block other players from collecting resources

### Technical Architecture

```
src/
├── models/        # Data models and type definitions
├── map/          # Map generation algorithms
│   ├── hexGenerator.ts        # Hex grid generation
│   ├── delaunayGenerator.ts   # Delaunay-centroid polygon generation
│   └── validator.ts           # Map validation logic
├── core/         # Game rules engine
│   ├── game.ts       # Core game logic and state management
│   ├── robber.ts     # Robber and knight mechanics
│   └── utils.ts      # Utility functions
├── api/          # Public API
└── tests/        # Unit and integration tests
```

## Getting Started

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Play the Game

Open `index.html` in a web browser to play:

```bash
npm run serve
```

Then navigate to `http://localhost:8080`

## Map Types

### Standard Catan Map

The classic 19-hex Catan board layout. Guaranteed to work correctly with all game mechanics.

```typescript
const game = createGame(['Alice', 'Bob', 'Charlie'], {
  mapType: 'standard',
  seed: 12345
});
```

### Expanded Hex Grid

A larger hexagonal map for extended gameplay. Specify the desired number of tiles.

```typescript
const game = createGame(['Alice', 'Bob', 'Charlie'], {
  mapType: 'expanded-hex',
  expandedMapSize: 37,  // radius-3 hex grid
  seed: 12345
});
```

### Delaunay Polygon Map (Experimental)

Generates organic-looking maps using the Delaunay-centroid method as described in `delaunay_centroid_mapgen.md`.

**Note**: This generator is experimental and may fall back to hex grids if validation fails.

```typescript
const game = createGame(['Alice', 'Bob', 'Charlie'], {
  mapType: 'expanded-delaunay',
  delaunayTileCount: 30,
  seed: 12345
});
```

## API Reference

### Core Functions

```typescript
// Create a new game
function createGame(
  playerNames: string[],
  options: GameOptions
): GameState

// Generate a map
function generateMap(options: GameOptions): MapData

// Validate a map
function validateMap(mapData: MapData): ValidationResult

// Apply an action
function applyAction(state: GameState, action: Action): GameState

// Roll dice
function rollDice(rng?: SeededRandom): number

// Collect resources from a dice roll
function collectResources(state: GameState, diceRoll: number): GameState
```

### Game Actions

Players can perform the following actions:

- `placeSettlement`: Place a settlement on an empty node
- `placeRoad`: Place a road on an empty edge
- `upgradeToCity`: Upgrade a settlement to a city
- `buyDevelopmentCard`: Purchase a development card
- `endTurn`: End the current player's turn

## Game Rules

### Building Costs

- **Road**: 1 brick + 1 wood
- **Settlement**: 1 brick + 1 wood + 1 sheep + 1 wheat
- **City**: 2 wheat + 3 ore
- **Development Card**: 1 sheep + 1 wheat + 1 ore

### Placement Rules

- **Settlements**:
  - Must be on an empty node
  - No adjacent settlements allowed (distance rule)
  - Must connect to your road network (except during setup)

- **Roads**:
  - Must connect to your existing road/settlement/city network
  - Cannot overlap with other players' roads

- **Cities**:
  - Can only upgrade your own settlements

### Victory Conditions

- First player to reach 10 victory points wins
- Victory points from:
  - Settlements: 1 point each
  - Cities: 2 points each
  - Longest Road (≥5): 2 points
  - Largest Army (≥3 knights): 2 points

## Map Validation

All generated maps are validated against the following constraints:

1. **Vertex Constraint**: Interior nodes touch exactly 3 tiles; boundary nodes touch 1-3 tiles
2. **Connectivity**: All tiles must be reachable from any starting tile
3. **Consistency**: All node/edge/tile references must be bidirectional
4. **Planarity**: The map must form a valid planar graph

## Enhanced Knights (Optional)

When enabled, knights have additional mechanics:

- Knights remain on the board after being played
- They block resource collection for other players on adjacent tiles
- The knight's owner still collects resources normally
- Adds strategic depth to resource control

## Web UI

The included web interface (`index.html`) provides:

- Map type selection (Standard, Expanded Hex, Delaunay)
- Player setup (2-4 players)
- Interactive game board with click-to-place mechanics
- Real-time player stats and resource tracking
- Dice rolling and turn management

## Development

### Project Structure

- TypeScript for type safety and better developer experience
- Modular architecture with clear separation of concerns
- Deterministic map generation using seeded RNG
- Comprehensive validation and error handling

### Known Issues

- Hex map generator has connectivity issues that are being debugged
- Delaunay generator may not always satisfy the vertex-degree=3 constraint
- Fallback to hex maps is implemented when validation fails

## References

- [Catan Clone Specification](./catan_clone_spec.md)
- [Delaunay Centroid Map Generation](./delaunay_centroid_mapgen.md)

## License

MIT

## Future Enhancements

- Development cards (beyond knights)
- Ports and maritime trade (2:1, 3:1 trades)
- AI opponents
- Multiplayer networking
- More sophisticated Delaunay polygon generation
- Additional victory point cards
- Customizable rule sets
