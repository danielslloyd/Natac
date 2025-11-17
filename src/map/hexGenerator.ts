// Regular hexagonal map generator for Catan-like boards

import type { Tile, Node, Edge, MapData, MapGeneratorParams } from '../models/types.js';
import { TileShape, Resource } from '../models/types.js';
import {
  generateId,
  SeededRandom,
  hexToPixel,
  hexCorners,
  hexSpiral,
  pointsEqual,
  type HexCoord
} from '../core/utils.js';

const HEX_SIZE = 50; // Visual size for rendering

interface NodeKey {
  position: [number, number];
  nodeId: string;
}

export function generateRegularHexMap(params: MapGeneratorParams): MapData {
  // Calculate hex radius from target tile count
  // Hex spiral formula: tiles = 1 + 3*r*(r+1)
  // For common counts: r=0→1, r=1→7, r=2→19, r=3→37, r=4→61
  let radius = 2; // Default
  if (params.targetTileCount) {
    // Find radius that produces closest tile count without exceeding target
    for (let r = 0; r <= 10; r++) {
      const tilesAtRadius = 1 + 3 * r * (r + 1);
      if (tilesAtRadius <= params.targetTileCount) {
        radius = r;
      } else {
        break;
      }
    }
  }

  const rng = new SeededRandom(params.seed);

  // Generate hex coordinates
  const hexCoords = hexSpiral({ q: 0, r: 0 }, radius);

  // Create tiles with positions
  const hexTiles: Array<{
    hex: HexCoord;
    center: [number, number];
    corners: [number, number][];
    id: string;
  }> = [];

  hexCoords.forEach(hex => {
    const center = hexToPixel(hex, HEX_SIZE);
    const corners = hexCorners(center, HEX_SIZE);
    hexTiles.push({
      hex,
      center,
      corners,
      id: generateId('tile')
    });
  });

  // Build node map by deduplicating corners
  const nodeMap = new Map<string, NodeKey>();

  function getOrCreateNode(position: [number, number]): string {
    // Use rounded coordinates as key for deduplication
    const key = `${position[0].toFixed(1)},${position[1].toFixed(1)}`;

    const existing = nodeMap.get(key);
    if (existing) {
      return existing.nodeId;
    }

    // Create new node
    const nodeId = generateId('node');
    nodeMap.set(key, { position, nodeId });
    return nodeId;
  }

  // Create nodes for each hex corner
  hexTiles.forEach(hexTile => {
    hexTile.corners.forEach(corner => {
      getOrCreateNode(corner);
    });
  });

  // Build edge map
  const edgeMap = new Map<string, string>(); // key -> edgeId

  function getOrCreateEdge(nodeA: string, nodeB: string): string {
    const key1 = `${nodeA}:${nodeB}`;
    const key2 = `${nodeB}:${nodeA}`;

    if (edgeMap.has(key1)) return edgeMap.get(key1)!;
    if (edgeMap.has(key2)) return edgeMap.get(key2)!;

    const edgeId = generateId('edge');
    edgeMap.set(key1, edgeId);
    return edgeId;
  }

  // Create tiles with node and edge references
  const tiles: Tile[] = hexTiles.map(hexTile => {
    const nodeIds = hexTile.corners.map(corner => getOrCreateNode(corner));
    const edgeIds: string[] = [];

    for (let i = 0; i < nodeIds.length; i++) {
      const next = (i + 1) % nodeIds.length;
      edgeIds.push(getOrCreateEdge(nodeIds[i], nodeIds[next]));
    }

    return {
      id: hexTile.id,
      shape: TileShape.HEXAGON,
      polygonPoints: hexTile.corners,
      resource: Resource.WOOD, // Will be assigned later
      diceNumber: null,
      edges: edgeIds,
      nodes: nodeIds,
      robberPresent: false
    };
  });

  // Build node-to-tiles mapping
  const nodeTilesMap = new Map<string, string[]>();
  tiles.forEach(tile => {
    tile.nodes.forEach(nodeId => {
      if (!nodeTilesMap.has(nodeId)) {
        nodeTilesMap.set(nodeId, []);
      }
      nodeTilesMap.get(nodeId)!.push(tile.id);
    });
  });

  // Create node objects
  const nodes: Node[] = Array.from(nodeMap.values()).map(nodeData => ({
    id: nodeData.nodeId,
    location: nodeData.position,
    tiles: nodeTilesMap.get(nodeData.nodeId) || [],
    occupant: null
  }));

  // Build edge objects with tile references
  const edges: Edge[] = [];
  const processedEdges = new Set<string>();

  tiles.forEach(tile => {
    for (let i = 0; i < tile.nodes.length; i++) {
      const nodeA = tile.nodes[i];
      const nodeB = tile.nodes[(i + 1) % tile.nodes.length];
      const edgeId = getOrCreateEdge(nodeA, nodeB);

      if (!processedEdges.has(edgeId)) {
        processedEdges.add(edgeId);

        // Find which tiles share this edge
        const tilesWithEdge = tiles.filter(t => t.edges.includes(edgeId));

        edges.push({
          id: edgeId,
          nodeA,
          nodeB,
          tileLeft: tilesWithEdge[0]?.id || null,
          tileRight: tilesWithEdge[1]?.id || null,
          roadOwner: null
        });
      }
    }
  });

  // Assign resources and dice numbers
  assignResourcesAndDice(tiles, rng);

  return { tiles, nodes, edges };
}

function assignResourcesAndDice(tiles: Tile[], rng: SeededRandom): void {
  // Standard Catan resource distribution for 19 tiles
  const resources: Resource[] = [
    Resource.WOOD, Resource.WOOD, Resource.WOOD, Resource.WOOD,
    Resource.BRICK, Resource.BRICK, Resource.BRICK,
    Resource.SHEEP, Resource.SHEEP, Resource.SHEEP, Resource.SHEEP,
    Resource.WHEAT, Resource.WHEAT, Resource.WHEAT, Resource.WHEAT,
    Resource.ORE, Resource.ORE, Resource.ORE,
    Resource.DESERT
  ];

  // Standard dice numbers (excluding 7)
  const diceNumbers = [
    2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
  ];

  // Shuffle resources
  const shuffledResources = rng.shuffle(resources);
  const shuffledDice = rng.shuffle(diceNumbers);

  let diceIdx = 0;
  tiles.forEach((tile, idx) => {
    if (idx < shuffledResources.length) {
      tile.resource = shuffledResources[idx];

      if (tile.resource === Resource.DESERT) {
        tile.diceNumber = null;
        tile.robberPresent = true; // Robber starts on desert
      } else {
        tile.diceNumber = shuffledDice[diceIdx++];
      }
    }
  });

  // Handle case where we have more/fewer tiles than standard
  if (tiles.length > shuffledResources.length) {
    // Assign random resources to extra tiles
    const extraResources: Resource[] = [Resource.WOOD, Resource.BRICK, Resource.SHEEP, Resource.WHEAT, Resource.ORE];
    for (let i = shuffledResources.length; i < tiles.length; i++) {
      tiles[i].resource = extraResources[rng.nextInt(0, extraResources.length - 1)];
      tiles[i].diceNumber = diceNumbers[rng.nextInt(0, diceNumbers.length - 1)];
    }
  }
}

export function generateStandardCatanMap(seed?: string | number): MapData {
  return generateRegularHexMap({
    seed,
    targetTileCount: 19 // Standard Catan has 19 hexes
  });
}

export function generateExpandedHexMap(
  size: number = 30,
  seed?: string | number
): MapData {
  return generateRegularHexMap({
    seed,
    targetTileCount: size
  });
}
