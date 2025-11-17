// Bridge between mapgen.js (visualization code) and TypeScript game logic
// Converts from the redCircles/blueNodes/greenEdges format to MapData format

import type { MapData, Tile, Node, Edge } from '../models/types.js';
import { TileShape, Resource } from '../models/types.js';
import { generateId, SeededRandom } from '../core/utils.js';

// Declare window.generateMapData from mapgen.js
declare global {
  interface Window {
    generateMapData: (
      mapType: 'standard-catan' | 'expanded-hex' | 'delaunay-polygon',
      numTiles: number,
      erosionRounds: number
    ) => {
      tiles: Array<{
        id: number;
        position: [number, number];
        blueNodes: number[]; // Centroids of triangles containing this point
        greenEdges: Array<[number, number]>; // Voronoi edges of this tile's boundary
        isWater: boolean;
        isLand: boolean;
      }>;
      blueNodes: Array<{ id: number; position: [number, number] }>;
      greenEdges: Array<{ from: number; to: number }>; // Voronoi edges (tile boundaries)
      blackEdges: Array<{ from: number; to: number }>; // Delaunay edges (tile connectivity)
      metadata: {
        mapType: string;
        totalLandTiles: number;
        totalWaterTiles: number;
        totalBlueNodes: number;
        totalGreenEdges: number;
        totalBlackEdges: number;
      };
    };
  }
}

export function generateMapFromVisualization(
  mapType: 'standard-catan' | 'expanded-hex' | 'delaunay-polygon',
  numTiles: number,
  erosionRounds: number,
  seed: string | number
): MapData {
  // Check if window.generateMapData is available
  if (typeof window === 'undefined' || !window.generateMapData) {
    throw new Error('window.generateMapData not available - make sure mapgen.js is loaded');
  }

  // Call the visualization generator
  const vizData = window.generateMapData(mapType, numTiles, erosionRounds);

  // Convert to MapData format
  return convertVizDataToMapData(vizData, seed);
}

function convertVizDataToMapData(
  vizData: {
    tiles: Array<{
      id: number;
      position: [number, number];
      blueNodes: number[];
      greenEdges: Array<[number, number]>;
      isWater: boolean;
      isLand: boolean;
    }>;
    blueNodes: Array<{ id: number; position: [number, number] }>;
    greenEdges: Array<{ from: number; to: number }>;
    blackEdges: Array<{ from: number; to: number }>;
  },
  seed: string | number
): MapData {
  const rng = new SeededRandom(seed);

  // Create ID mappings
  const tileIdMap = new Map<number, string>(); // vizId -> gameId
  const nodeIdMap = new Map<number, string>(); // vizId -> gameId

  // Create nodes from blueNodes
  const nodes: Node[] = vizData.blueNodes.map(blueNode => {
    const nodeId = generateId('node');
    nodeIdMap.set(blueNode.id, nodeId);

    return {
      id: nodeId,
      location: blueNode.position,
      tiles: [], // Will fill in later
      occupant: null
    };
  });

  // Create tiles using graph-based boundaries (no spatial approximation!)
  const tiles: Tile[] = vizData.tiles
    .filter(tileData => tileData.isLand) // Only include land tiles
    .map(tileData => {
      const tileId = generateId('tile');
      tileIdMap.set(tileData.id, tileId);

      // Get blue nodes for this tile (already computed in visualization)
      const tilePos = tileData.position;
      const sortedNodeIds = tileData.blueNodes
        .map(blueNodeIdx => {
          const nodeId = nodeIdMap.get(blueNodeIdx);
          const blueNode = vizData.blueNodes.find(n => n.id === blueNodeIdx);
          if (!nodeId || !blueNode) return null;

          const dx = blueNode.position[0] - tilePos[0];
          const dy = blueNode.position[1] - tilePos[1];
          const angle = Math.atan2(dy, dx);
          return { id: nodeId, angle };
        })
        .filter((n): n is { id: string; angle: number } => n !== null)
        .sort((a, b) => a.angle - b.angle)
        .map(n => n.id);

      // Determine shape based on number of nodes
      const shape = sortedNodeIds.length as TileShape;

      // Create polygon points from surrounding nodes
      const polygonPoints: [number, number][] = tileData.blueNodes.map(vizNodeId => {
        const node = vizData.blueNodes.find(n => n.id === vizNodeId);
        return node ? node.position : tileData.position;
      });

      return {
        id: tileId,
        shape,
        polygonPoints,
        resource: Resource.WOOD, // Will assign properly later
        diceNumber: null, // Will assign later
        edges: [], // Will fill in after creating edges
        nodes: sortedNodeIds,
        robberPresent: false
      };
    });

  // Update nodes with their adjacent tiles
  tiles.forEach(tile => {
    tile.nodes.forEach(nodeId => {
      const node = nodes.find(n => n.id === nodeId);
      if (node && !node.tiles.includes(tile.id)) {
        node.tiles.push(tile.id);
      }
    });
  });

  // Filter nodes to only those with exactly 3 tiles (valid Catan nodes)
  const validNodes = nodes.filter(node => node.tiles.length === 3);

  // Create edges from green edges (Voronoi edges = tile boundaries)
  const edges: Edge[] = [];
  const edgeMap = new Map<string, string>(); // "vizNodeA:vizNodeB" -> edgeId

  vizData.greenEdges.forEach(vizEdge => {
    const nodeAId = nodeIdMap.get(vizEdge.from);
    const nodeBId = nodeIdMap.get(vizEdge.to);

    if (!nodeAId || !nodeBId) return;

    // Only include edges between valid nodes
    const nodeA = validNodes.find(n => n.id === nodeAId);
    const nodeB = validNodes.find(n => n.id === nodeBId);

    if (!nodeA || !nodeB) return;

    const edgeId = generateId('edge');
    const edgeKey1 = `${vizEdge.from}:${vizEdge.to}`;
    const edgeKey2 = `${vizEdge.to}:${vizEdge.from}`;
    edgeMap.set(edgeKey1, edgeId);
    edgeMap.set(edgeKey2, edgeId);

    // Find tiles on either side of this edge (tiles that share both nodes)
    const commonTiles = tiles.filter(tile =>
      tile.nodes.includes(nodeAId) && tile.nodes.includes(nodeBId)
    );

    edges.push({
      id: edgeId,
      nodeA: nodeAId,
      nodeB: nodeBId,
      tileLeft: commonTiles[0]?.id || null,
      tileRight: commonTiles[1]?.id || null,
      roadOwner: null
    });
  });

  // Update tiles with their edge IDs
  tiles.forEach(tile => {
    const tileEdges: string[] = [];

    // For each pair of consecutive nodes in the tile, find the edge
    for (let i = 0; i < tile.nodes.length; i++) {
      const nodeA = tile.nodes[i];
      const nodeB = tile.nodes[(i + 1) % tile.nodes.length];

      // Find edge connecting these nodes
      const edge = edges.find(e =>
        (e.nodeA === nodeA && e.nodeB === nodeB) ||
        (e.nodeA === nodeB && e.nodeB === nodeA)
      );

      if (edge) {
        tileEdges.push(edge.id);
      }
    }

    tile.edges = tileEdges;
  });

  // Assign resources and dice numbers
  assignResourcesAndDice(tiles, rng);

  return { tiles, nodes: validNodes, edges };
}

function assignResourcesAndDice(tiles: Tile[], rng: SeededRandom): void {
  const resources: Resource[] = [
    Resource.WOOD,
    Resource.BRICK,
    Resource.SHEEP,
    Resource.WHEAT,
    Resource.ORE
  ];

  const diceNumbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

  // Assign one desert
  const desertIdx = rng.nextInt(0, tiles.length - 1);

  tiles.forEach((tile, idx) => {
    if (idx === desertIdx) {
      tile.resource = Resource.DESERT;
      tile.diceNumber = null;
      tile.robberPresent = true;
    } else {
      tile.resource = resources[rng.nextInt(0, resources.length - 1)];

      // Assign dice number if we have any left
      if (diceNumbers.length > 0) {
        const diceIdx = rng.nextInt(0, diceNumbers.length - 1);
        tile.diceNumber = diceNumbers[diceIdx];
        // Don't remove from array - we can reuse dice numbers if needed
      } else {
        // Fallback if we run out
        tile.diceNumber = rng.nextInt(2, 12);
        if (tile.diceNumber === 7) tile.diceNumber = 8;
      }
    }
  });
}
