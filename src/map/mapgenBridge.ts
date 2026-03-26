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

// Walk the adjacency graph formed by greenEdges to produce boundary order.
// Each tile's greenEdges connect adjacent blue nodes (triangle centroids)
// that both belong to the tile, forming the polygon boundary as a cycle/path.
function orderByTopology(
  blueNodeIds: number[],
  greenEdges: Array<[number, number]>
): number[] {
  if (blueNodeIds.length <= 2) return blueNodeIds;

  const nodeSet = new Set(blueNodeIds);

  // Build adjacency list from green edges within this tile
  const adj = new Map<number, number[]>();
  for (const id of blueNodeIds) {
    adj.set(id, []);
  }
  for (const [a, b] of greenEdges) {
    if (nodeSet.has(a) && nodeSet.has(b)) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
  }

  // Walk the boundary starting from the first node
  const ordered: number[] = [];
  const visited = new Set<number>();
  let current = blueNodeIds[0];

  while (ordered.length < blueNodeIds.length) {
    ordered.push(current);
    visited.add(current);
    const neighbors = adj.get(current) || [];
    const next = neighbors.find(n => !visited.has(n));
    if (next === undefined) break;
    current = next;
  }

  // If topology walk didn't cover all nodes (disconnected graph from
  // boundary filtering), fall back to atan2 sort for remaining nodes
  if (ordered.length < blueNodeIds.length) {
    const missing = blueNodeIds.filter(id => !visited.has(id));
    ordered.push(...missing);
  }

  return ordered;
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

      // Build a lookup from viz blue node index to game node id + position
      const nodeEntries = new Map<number, { id: string; position: [number, number] }>();
      for (const blueNodeIdx of tileData.blueNodes) {
        const nodeId = nodeIdMap.get(blueNodeIdx);
        const blueNode = vizData.blueNodes.find(n => n.id === blueNodeIdx);
        if (nodeId && blueNode) {
          nodeEntries.set(blueNodeIdx, { id: nodeId, position: blueNode.position as [number, number] });
        }
      }

      // Order nodes by walking the boundary topology (greenEdges), not by
      // geometric angle. Atan2 sort fails for non-convex cells, which occur
      // because these Voronoi cells use triangle centroids, not circumcenters.
      // The greenEdges connect adjacent blue nodes within the tile, forming
      // the polygon boundary — walking that graph always gives the correct order.
      const orderedVizIds = orderByTopology(
        tileData.blueNodes.filter(id => nodeEntries.has(id)),
        tileData.greenEdges
      );

      const sortedNodeIds = orderedVizIds.map(vizId => nodeEntries.get(vizId)!.id);
      const polygonPoints = orderedVizIds.map(vizId => nodeEntries.get(vizId)!.position);

      // Determine shape based on number of nodes
      const shape = sortedNodeIds.length as TileShape;

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

  // Filter nodes to only valid Catan nodes:
  // - Interior nodes: 3 tiles (standard vertex)
  // - Boundary nodes: 1-2 tiles (edge of map)
  const validNodes = nodes.filter(node =>
    node.tiles.length >= 1 && node.tiles.length <= 3
  );
  const validNodeIds = new Set(validNodes.map(n => n.id));

  // Mark boundary nodes (those with < 3 tiles)
  validNodes.forEach(node => {
    node.isBoundary = node.tiles.length < 3;
  });

  // Update tiles to only reference valid nodes, preserving angular order
  tiles.forEach(tile => {
    // Filter nodes to only valid ones, but keep the original angular sort order
    tile.nodes = tile.nodes.filter(nodeId => validNodeIds.has(nodeId));
  });

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

    const tileLeft = commonTiles[0]?.id || null;
    const tileRight = commonTiles[1]?.id || null;

    edges.push({
      id: edgeId,
      nodeA: nodeAId,
      nodeB: nodeBId,
      tileLeft,
      tileRight,
      roadOwner: null,
      isBoundary: !tileLeft || !tileRight // Boundary if missing a tile on either side
    });
  });

  // Build edges and update tiles
  tiles.forEach(tile => {
    if (tile.nodes.length === 0) return;

    // Build edges list using the angular-ordered nodes
    const tileEdges: string[] = [];
    for (let i = 0; i < tile.nodes.length; i++) {
      const nodeA = tile.nodes[i];
      const nodeB = tile.nodes[(i + 1) % tile.nodes.length];

      // Find edge connecting these consecutive nodes
      const edge = edges.find(e =>
        (e.nodeA === nodeA && e.nodeB === nodeB) ||
        (e.nodeA === nodeB && e.nodeB === nodeA)
      );

      if (edge) {
        tileEdges.push(edge.id);
      }
    }

    tile.edges = tileEdges;

    // Mark as boundary tile if it has any boundary edges or boundary nodes
    const hasBoundaryEdge = tileEdges.some(edgeId => {
      const edge = edges.find(e => e.id === edgeId);
      return edge?.isBoundary;
    });
    const hasBoundaryNode = tile.nodes.some(nodeId => {
      const node = validNodes.find(n => n.id === nodeId);
      return node?.isBoundary;
    });
    tile.isBoundary = hasBoundaryEdge || hasBoundaryNode;

    // Update shape based on boundary status
    if (tile.isBoundary) {
      // For boundary tiles, keep the original shape (target shape)
      // but allow actual nodes/edges to be fewer
      // Shape represents the "ideal" shape, actual count can be less
    } else {
      // For interior tiles, shape must match node count
      tile.shape = tile.nodes.length as TileShape;
    }
  });

  // Assign resources and dice numbers
  assignResourcesAndDice(tiles, rng);

  return { tiles, nodes: validNodes, edges };
}

function assignResourcesAndDice(tiles: Tile[], rng: SeededRandom): void {
  // Standard Catan deck composition
  const resourceDeck = [
    Resource.ORE, Resource.ORE, Resource.ORE,
    Resource.BRICK, Resource.BRICK, Resource.BRICK,
    Resource.WOOD, Resource.WOOD, Resource.WOOD, Resource.WOOD,
    Resource.SHEEP, Resource.SHEEP, Resource.SHEEP, Resource.SHEEP,
    Resource.WHEAT, Resource.WHEAT, Resource.WHEAT, Resource.WHEAT,
    Resource.DESERT
  ];

  const diceDeck = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

  // Shuffle and deal from decks, creating new decks as needed
  const shuffledResources: Resource[] = [];
  const shuffledDice: number[] = [];

  // Create enough shuffled decks to cover all tiles
  while (shuffledResources.length < tiles.length) {
    const deckCopy = [...resourceDeck];
    // Fisher-Yates shuffle
    for (let i = deckCopy.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i);
      [deckCopy[i], deckCopy[j]] = [deckCopy[j], deckCopy[i]];
    }
    shuffledResources.push(...deckCopy);
  }

  while (shuffledDice.length < tiles.length) {
    const deckCopy = [...diceDeck];
    // Fisher-Yates shuffle
    for (let i = deckCopy.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i);
      [deckCopy[i], deckCopy[j]] = [deckCopy[j], deckCopy[i]];
    }
    shuffledDice.push(...deckCopy);
  }

  // Deal to tiles
  let diceIdx = 0;
  tiles.forEach((tile, idx) => {
    tile.resource = shuffledResources[idx];

    if (tile.resource === Resource.DESERT) {
      tile.diceNumber = null;
      tile.robberPresent = true;
    } else {
      tile.diceNumber = shuffledDice[diceIdx++];
      tile.robberPresent = false;
    }
  });
}
