// Hard-coded standard Catan board
import { TileShape, Resource } from '../models/types.js';
import { generateId, SeededRandom } from '../core/utils.js';
// Standard Catan board: 19 hexes in specific layout
// Using axial coordinates (q, r) for hex positions
const STANDARD_HEX_COORDS = [
    // Center
    { q: 0, r: 0 },
    // Ring 1
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    // Ring 2
    { q: 2, r: 0 }, { q: 2, r: -1 }, { q: 2, r: -2 },
    { q: 1, r: -2 }, { q: 0, r: -2 }, { q: -1, r: -1 },
    { q: -2, r: 0 }, { q: -2, r: 1 }, { q: -2, r: 2 },
    { q: -1, r: 2 }, { q: 0, r: 2 }, { q: 1, r: 1 }
];
const HEX_SIZE = 50;
function axialToPixel(q, r) {
    const x = HEX_SIZE * (3 / 2 * q);
    const y = HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
    return [x, y];
}
function hexCorners(center) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        corners.push([
            center[0] + HEX_SIZE * Math.cos(angle),
            center[1] + HEX_SIZE * Math.sin(angle)
        ]);
    }
    return corners;
}
export function generateStandardCatanBoard(seed) {
    const rng = new SeededRandom(seed);
    // First pass: create all tiles with their corner positions
    const tilesData = [];
    STANDARD_HEX_COORDS.forEach(coord => {
        const center = axialToPixel(coord.q, coord.r);
        const corners = hexCorners(center);
        tilesData.push({
            id: generateId('tile'),
            corners
        });
    });
    // Second pass: build node map by deduplicating corner positions
    const nodeMap = new Map();
    tilesData.forEach(tileData => {
        tileData.corners.forEach(corner => {
            const key = `${corner[0].toFixed(1)},${corner[1].toFixed(1)}`;
            if (!nodeMap.has(key)) {
                nodeMap.set(key, {
                    id: generateId('node'),
                    pos: corner,
                    tileIds: [tileData.id]
                });
            }
            else {
                nodeMap.get(key).tileIds.push(tileData.id);
            }
        });
    });
    // Third pass: create tiles with node references
    const tiles = tilesData.map(tileData => {
        const nodeIds = tileData.corners.map(corner => {
            const key = `${corner[0].toFixed(1)},${corner[1].toFixed(1)}`;
            return nodeMap.get(key).id;
        });
        return {
            id: tileData.id,
            shape: TileShape.HEXAGON,
            polygonPoints: tileData.corners,
            resource: Resource.WOOD, // Will be assigned later
            diceNumber: null,
            edges: [], // Will be filled later
            nodes: nodeIds,
            robberPresent: false
        };
    });
    // Fourth pass: create edges
    const edgeMap = new Map();
    tiles.forEach(tile => {
        for (let i = 0; i < tile.nodes.length; i++) {
            const nodeA = tile.nodes[i];
            const nodeB = tile.nodes[(i + 1) % tile.nodes.length];
            // Create edge key (sorted to avoid duplicates)
            const key = [nodeA, nodeB].sort().join(':');
            if (!edgeMap.has(key)) {
                edgeMap.set(key, {
                    id: generateId('edge'),
                    nodeA,
                    nodeB,
                    tiles: [tile.id]
                });
            }
            else {
                edgeMap.get(key).tiles.push(tile.id);
            }
            // Add edge to tile
            if (!tile.edges.includes(edgeMap.get(key).id)) {
                tile.edges.push(edgeMap.get(key).id);
            }
        }
    });
    // Create edge list
    const edges = Array.from(edgeMap.values()).map(e => ({
        id: e.id,
        nodeA: e.nodeA,
        nodeB: e.nodeB,
        tileLeft: e.tiles[0] || null,
        tileRight: e.tiles[1] || null,
        roadOwner: null
    }));
    // Create node list
    const nodes = Array.from(nodeMap.values()).map(n => ({
        id: n.id,
        location: n.pos,
        tiles: n.tileIds,
        occupant: null
    }));
    // Assign resources and dice numbers
    assignStandardResources(tiles, rng);
    return { tiles, nodes, edges };
}
function assignStandardResources(tiles, rng) {
    // Standard Catan distribution
    const resources = [
        Resource.WOOD, Resource.WOOD, Resource.WOOD, Resource.WOOD,
        Resource.BRICK, Resource.BRICK, Resource.BRICK,
        Resource.SHEEP, Resource.SHEEP, Resource.SHEEP, Resource.SHEEP,
        Resource.WHEAT, Resource.WHEAT, Resource.WHEAT, Resource.WHEAT,
        Resource.ORE, Resource.ORE, Resource.ORE,
        Resource.DESERT
    ];
    const diceNumbers = [
        2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
    ];
    const shuffledResources = rng.shuffle(resources);
    const shuffledDice = rng.shuffle(diceNumbers);
    let diceIdx = 0;
    tiles.forEach((tile, idx) => {
        tile.resource = shuffledResources[idx];
        if (tile.resource === Resource.DESERT) {
            tile.diceNumber = null;
            tile.robberPresent = true;
        }
        else {
            tile.diceNumber = shuffledDice[diceIdx++];
        }
    });
}
//# sourceMappingURL=standardBoard.js.map