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
    // Update tiles with their edge IDs and fix node winding order
    tiles.forEach(tile => {
        if (tile.nodes.length === 0)
            return;
        // Reorder nodes to form a proper cycle by walking edges
        const orderedNodes = [];
        const remainingNodes = new Set(tile.nodes);
        // Start with first node
        let currentNode = tile.nodes[0];
        orderedNodes.push(currentNode);
        remainingNodes.delete(currentNode);
        // Walk the perimeter by finding edges
        while (remainingNodes.size > 0) {
            // Find an edge that connects currentNode to another node in remainingNodes
            const nextEdge = edges.find(e => {
                if (e.nodeA === currentNode && remainingNodes.has(e.nodeB))
                    return true;
                if (e.nodeB === currentNode && remainingNodes.has(e.nodeA))
                    return true;
                return false;
            });
            if (!nextEdge) {
                // Can't find next edge - might be a boundary tile with missing edges
                // Just add remaining nodes in original order
                remainingNodes.forEach(nodeId => orderedNodes.push(nodeId));
                break;
            }
            // Move to next node
            const nextNode = nextEdge.nodeA === currentNode ? nextEdge.nodeB : nextEdge.nodeA;
            orderedNodes.push(nextNode);
            remainingNodes.delete(nextNode);
            currentNode = nextNode;
        }
        // Update tile nodes with proper winding order
        tile.nodes = orderedNodes;
        // Now build edges list using the ordered nodes
        const tileEdges = [];
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
    const shuffledResources = [];
    const shuffledDice = [];
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
        }
        else {
            tile.diceNumber = shuffledDice[diceIdx++];
            tile.robberPresent = false;
        }
    });
}
//# sourceMappingURL=mapgenBridge.js.map