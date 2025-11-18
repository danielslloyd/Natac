// Bridge between mapgen.js (visualization code) and TypeScript game logic
// Converts from the redCircles/blueNodes/greenEdges format to MapData format
import { Resource } from '../models/types.js';
import { generateId, SeededRandom } from '../core/utils.js';
export function generateMapFromVisualization(mapType, numTiles, erosionRounds, seed) {
    // Check if window.generateMapData is available
    if (typeof window === 'undefined' || !window.generateMapData) {
        throw new Error('window.generateMapData not available - make sure mapgen.js is loaded');
    }
    // Call the visualization generator
    const vizData = window.generateMapData(mapType, numTiles, erosionRounds);
    // Convert to MapData format
    return convertVizDataToMapData(vizData, seed);
}
function convertVizDataToMapData(vizData, seed) {
    const rng = new SeededRandom(seed);
    // Create ID mappings
    const tileIdMap = new Map(); // vizId -> gameId
    const nodeIdMap = new Map(); // vizId -> gameId
    // Create nodes from blueNodes
    const nodes = vizData.blueNodes.map(blueNode => {
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
    const tiles = vizData.tiles
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
            if (!nodeId || !blueNode)
                return null;
            const dx = blueNode.position[0] - tilePos[0];
            const dy = blueNode.position[1] - tilePos[1];
            const angle = Math.atan2(dy, dx);
            return { id: nodeId, angle };
        })
            .filter((n) => n !== null)
            .sort((a, b) => a.angle - b.angle)
            .map(n => n.id);
        // Determine shape based on number of nodes
        const shape = sortedNodeIds.length;
        // Create polygon points from surrounding nodes
        const polygonPoints = tileData.blueNodes.map(vizNodeId => {
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
    // Filter nodes to only valid Catan nodes:
    // - Interior nodes: 3 tiles (standard vertex)
    // - Boundary nodes: 1-2 tiles (edge of map)
    const validNodes = nodes.filter(node => node.tiles.length >= 1 && node.tiles.length <= 3);
    const validNodeIds = new Set(validNodes.map(n => n.id));
    // Mark boundary nodes (those with < 3 tiles)
    validNodes.forEach(node => {
        node.isBoundary = node.tiles.length < 3;
    });
    // Update tiles to only reference valid nodes
    tiles.forEach(tile => {
        tile.nodes = tile.nodes.filter(nodeId => validNodeIds.has(nodeId));
        // Don't update shape yet - we'll set it based on boundary status after edges
    });
    // Create edges from green edges (Voronoi edges = tile boundaries)
    const edges = [];
    const edgeMap = new Map(); // "vizNodeA:vizNodeB" -> edgeId
    vizData.greenEdges.forEach(vizEdge => {
        const nodeAId = nodeIdMap.get(vizEdge.from);
        const nodeBId = nodeIdMap.get(vizEdge.to);
        if (!nodeAId || !nodeBId)
            return;
        // Only include edges between valid nodes
        const nodeA = validNodes.find(n => n.id === nodeAId);
        const nodeB = validNodes.find(n => n.id === nodeBId);
        if (!nodeA || !nodeB)
            return;
        const edgeId = generateId('edge');
        const edgeKey1 = `${vizEdge.from}:${vizEdge.to}`;
        const edgeKey2 = `${vizEdge.to}:${vizEdge.from}`;
        edgeMap.set(edgeKey1, edgeId);
        edgeMap.set(edgeKey2, edgeId);
        // Find tiles on either side of this edge (tiles that share both nodes)
        const commonTiles = tiles.filter(tile => tile.nodes.includes(nodeAId) && tile.nodes.includes(nodeBId));
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
    // Update tiles with their edge IDs
    tiles.forEach(tile => {
        const tileEdges = [];
        // For each pair of consecutive nodes in the tile, find the edge
        for (let i = 0; i < tile.nodes.length; i++) {
            const nodeA = tile.nodes[i];
            const nodeB = tile.nodes[(i + 1) % tile.nodes.length];
            // Find edge connecting these nodes
            const edge = edges.find(e => (e.nodeA === nodeA && e.nodeB === nodeB) ||
                (e.nodeA === nodeB && e.nodeB === nodeA));
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
        }
        else {
            // For interior tiles, shape must match node count
            tile.shape = tile.nodes.length;
        }
    });
    // Assign resources and dice numbers
    assignResourcesAndDice(tiles, rng);
    return { tiles, nodes: validNodes, edges };
}
function assignResourcesAndDice(tiles, rng) {
    const resources = [
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
        }
        else {
            tile.resource = resources[rng.nextInt(0, resources.length - 1)];
            // Assign dice number if we have any left
            if (diceNumbers.length > 0) {
                const diceIdx = rng.nextInt(0, diceNumbers.length - 1);
                tile.diceNumber = diceNumbers[diceIdx];
                // Don't remove from array - we can reuse dice numbers if needed
            }
            else {
                // Fallback if we run out
                tile.diceNumber = rng.nextInt(2, 12);
                if (tile.diceNumber === 7)
                    tile.diceNumber = 8;
            }
        }
    });
}
//# sourceMappingURL=mapgenBridge.js.map