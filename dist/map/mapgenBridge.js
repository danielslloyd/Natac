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
    // Create node adjacency map (which nodes are connected by green edges)
    const nodeAdjacency = new Map();
    vizData.greenEdges.forEach(edge => {
        if (!nodeAdjacency.has(edge.from))
            nodeAdjacency.set(edge.from, new Set());
        if (!nodeAdjacency.has(edge.to))
            nodeAdjacency.set(edge.to, new Set());
        nodeAdjacency.get(edge.from).add(edge.to);
        nodeAdjacency.get(edge.to).add(edge.from);
    });
    // Build tile-to-nodes mapping
    // Each land tile (red circle) is surrounded by blue nodes (triangle centroids)
    // We need to find which blue nodes surround each red circle
    const tileToNodesMap = new Map();
    // For each land tile, find surrounding nodes
    // A blue node surrounds a red tile if the tile is one of the Delaunay triangles
    // that contributed to that node's position (i.e., the tile connects to the node via blackEdges)
    vizData.redCircles.land.forEach(tile => {
        const surroundingNodes = [];
        // Find all blue nodes that this tile connects to via green edges
        // This is determined by finding triangles that contain this tile vertex
        // For now, we'll use a spatial approach: find nodes within a reasonable distance
        // and verify they're connected via the Voronoi structure
        const tilePos = tile.position;
        const nearbyNodes = vizData.blueNodes.filter(node => {
            const dist = Math.sqrt(Math.pow(node.position[0] - tilePos[0], 2) +
                Math.pow(node.position[1] - tilePos[1], 2));
            return dist < 150; // Reasonable threshold based on typical tile size
        });
        // Sort by angle around tile center to get proper ordering
        const sortedNodes = nearbyNodes
            .map(node => {
            const dx = node.position[0] - tilePos[0];
            const dy = node.position[1] - tilePos[1];
            const angle = Math.atan2(dy, dx);
            return { id: node.id, angle };
        })
            .sort((a, b) => a.angle - b.angle)
            .map(n => n.id);
        tileToNodesMap.set(tile.id, sortedNodes);
    });
    // Create tiles
    const tiles = vizData.redCircles.land.map(tile => {
        const tileId = generateId('tile');
        tileIdMap.set(tile.id, tileId);
        const nodeIds = tileToNodesMap.get(tile.id) || [];
        const gameNodeIds = nodeIds.map(vizNodeId => nodeIdMap.get(vizNodeId)).filter(Boolean);
        // Determine shape based on number of nodes
        const shape = gameNodeIds.length;
        // Create polygon points from surrounding nodes
        const polygonPoints = nodeIds.map(vizNodeId => {
            const node = vizData.blueNodes.find(n => n.id === vizNodeId);
            return node ? node.position : tile.position;
        });
        // Create edge IDs (will fill in later)
        const edgeIds = [];
        return {
            id: tileId,
            shape,
            polygonPoints,
            resource: Resource.WOOD, // Will assign properly later
            diceNumber: null, // Will assign later
            edges: edgeIds, // Will fill in after creating edges
            nodes: gameNodeIds,
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