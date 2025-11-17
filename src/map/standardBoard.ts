// Hard-coded standard Catan board

import type { Tile, Node, Edge, MapData } from '../models/types.js';
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

// Flat-top hex orientation (standard for Catan)
function axialToPixel(q: number, r: number): [number, number] {
  const x = HEX_SIZE * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r);
  const y = HEX_SIZE * (3/2 * r);
  return [x, y];
}

// Flat-top hex corners (6 corners, starting from right, counter-clockwise)
function hexCorners(center: [number, number]): [number, number][] {
  const corners: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    corners.push([
      center[0] + HEX_SIZE * Math.cos(angle),
      center[1] + HEX_SIZE * Math.sin(angle)
    ]);
  }
  return corners;
}

export function generateStandardCatanBoard(seed?: string | number): MapData {
  const rng = new SeededRandom(seed);

  // First pass: create all tiles with their corner positions
  const tilesData: Array<{
    id: string;
    corners: [number, number][];
  }> = [];

  STANDARD_HEX_COORDS.forEach(coord => {
    const center = axialToPixel(coord.q, coord.r);
    const corners = hexCorners(center);
    tilesData.push({
      id: generateId('tile'),
      corners
    });
  });

  // Second pass: build node map by deduplicating corner positions
  const nodeMap = new Map<string, {
    id: string;
    pos: [number, number];
    tileIds: string[];
  }>();

  tilesData.forEach(tileData => {
    tileData.corners.forEach(corner => {
      const key = `${corner[0].toFixed(3)},${corner[1].toFixed(3)}`;

      if (!nodeMap.has(key)) {
        nodeMap.set(key, {
          id: generateId('node'),
          pos: corner,
          tileIds: [tileData.id]
        });
      } else {
        nodeMap.get(key)!.tileIds.push(tileData.id);
      }
    });
  });

  // Third pass: create tiles with node references
  const tiles: Tile[] = tilesData.map(tileData => {
    const nodeIds = tileData.corners.map(corner => {
      const key = `${corner[0].toFixed(3)},${corner[1].toFixed(3)}`;
      return nodeMap.get(key)!.id;
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
  const edgeMap = new Map<string, {
    id: string;
    nodeA: string;
    nodeB: string;
    tiles: string[];
  }>();

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
      } else {
        edgeMap.get(key)!.tiles.push(tile.id);
      }

      // Add edge to tile
      if (!tile.edges.includes(edgeMap.get(key)!.id)) {
        tile.edges.push(edgeMap.get(key)!.id);
      }
    }
  });

  // Create edge list
  const edges: Edge[] = Array.from(edgeMap.values()).map(e => ({
    id: e.id,
    nodeA: e.nodeA,
    nodeB: e.nodeB,
    tileLeft: e.tiles[0] || null,
    tileRight: e.tiles[1] || null,
    roadOwner: null
  }));

  // Create node list
  const nodes: Node[] = Array.from(nodeMap.values()).map(n => ({
    id: n.id,
    location: n.pos,
    tiles: n.tileIds,
    occupant: null
  }));

  // Assign resources and dice numbers
  assignStandardResources(tiles, rng);

  return { tiles, nodes, edges };
}

function assignStandardResources(tiles: Tile[], rng: SeededRandom): void {
  // Standard Catan distribution
  const resources: Resource[] = [
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
    } else {
      tile.diceNumber = shuffledDice[diceIdx++];
    }
  });
}
