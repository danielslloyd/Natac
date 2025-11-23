// Bridge between mapgen.js (visualization code) and TypeScript game logic
// Converts from the redCircles/blueNodes/greenEdges format to MapData format
import { Resource } from '../models/types.js';
import { generateId, SeededRandom } from '../core/utils.js';
// ============================================================================
// TEMPORARY DEBUG CODE FOR WINDING ORDER
// TODO: Remove after identifying correct winding method
// ============================================================================
// Debug: Track which method is used for each tile
const WINDING_DEBUG_COLORS = [
    '#FF6B6B', // Method 0: Original unsorted (RED)
    '#4ECDC4', // Method 1: Atan2 sorted matching nodes (CYAN)
    '#95E1D3', // Method 2: Signed area corrected (MINT)
    '#F9CA24' // Method 3: Convex hull based (YELLOW)
];
// Method 0: Original unsorted blueNodes (CURRENT BROKEN METHOD)
function method0_unsorted(blueNodes, vizData) {
    return blueNodes.map(vizNodeId => {
        const node = vizData.blueNodes.find((n) => n.id === vizNodeId);
        return node ? node.position : [0, 0];
    });
}
// Method 1: Atan2 sorted to match sortedNodeIds
function method1_atan2Sorted(blueNodes, tilePos, vizData) {
    const sortedNodes = blueNodes
        .map(vizNodeId => {
        const node = vizData.blueNodes.find((n) => n.id === vizNodeId);
        if (!node)
            return null;
        const dx = node.position[0] - tilePos[0];
        const dy = node.position[1] - tilePos[1];
        const angle = Math.atan2(dy, dx);
        return { vizNodeId, position: node.position, angle };
    })
        .filter((n) => n !== null)
        .sort((a, b) => a.angle - b.angle);
    return sortedNodes.map(n => n.position);
}
// Method 2: Signed area corrected
function method2_signedArea(blueNodes, tilePos, vizData) {
    // First get atan2 sorted
    const sorted = method1_atan2Sorted(blueNodes, tilePos, vizData);
    // Calculate signed area
    let signedArea = 0;
    for (let i = 0; i < sorted.length; i++) {
        const j = (i + 1) % sorted.length;
        signedArea += sorted[i][0] * sorted[j][1] - sorted[j][0] * sorted[i][1];
    }
    // If negative (clockwise), reverse to make counter-clockwise
    if (signedArea < 0) {
        return sorted.reverse();
    }
    return sorted;
}
// Method 3: Convex hull based
function method3_convexHull(blueNodes, tilePos, vizData) {
    const points = blueNodes.map(vizNodeId => {
        const node = vizData.blueNodes.find((n) => n.id === vizNodeId);
        return node ? node.position : tilePos;
    });
    if (points.length < 3)
        return points;
    // Find leftmost point
    let leftmost = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i][0] < points[leftmost][0] ||
            (points[i][0] === points[leftmost][0] && points[i][1] < points[leftmost][1])) {
            leftmost = i;
        }
    }
    // Sort by polar angle from leftmost point
    const sortedPoints = [...points];
    const pivot = sortedPoints[leftmost];
    sortedPoints.sort((a, b) => {
        if (a === pivot)
            return -1;
        if (b === pivot)
            return 1;
        const angleA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0]);
        const angleB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0]);
        if (Math.abs(angleA - angleB) < 1e-10) {
            // Same angle, sort by distance
            const distA = Math.hypot(a[0] - pivot[0], a[1] - pivot[1]);
            const distB = Math.hypot(b[0] - pivot[0], b[1] - pivot[1]);
            return distA - distB;
        }
        return angleA - angleB;
    });
    return sortedPoints;
}
// Apply the selected winding method
function applyWindingMethod(method, blueNodes, tilePos, vizData) {
    switch (method) {
        case 0: return method0_unsorted(blueNodes, vizData);
        case 1: return method1_atan2Sorted(blueNodes, tilePos, vizData);
        case 2: return method2_signedArea(blueNodes, tilePos, vizData);
        case 3: return method3_convexHull(blueNodes, tilePos, vizData);
    }
}
// Store debug info globally for visualization
window.windingDebugInfo = {
    methods: []
};
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
        // ============================================================================
        // TEMPORARY DEBUG: Randomly assign winding method and color code
        // TODO: Remove after identifying correct method
        // ============================================================================
        const windingMethod = Math.floor(Math.random() * 4);
        const debugColor = WINDING_DEBUG_COLORS[windingMethod];
        // Apply the selected winding method
        const polygonPoints = applyWindingMethod(windingMethod, tileData.blueNodes, tilePos, vizData);
        // Store debug info for visualization
        window.windingDebugInfo.methods.push({
            tileId,
            method: windingMethod,
            color: debugColor
        });
        // ============================================================================
        // END TEMPORARY DEBUG
        // ============================================================================
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
    // Update tiles to only reference valid nodes, preserving angular order
    tiles.forEach(tile => {
        // Filter nodes to only valid ones, but keep the original angular sort order
        tile.nodes = tile.nodes.filter(nodeId => validNodeIds.has(nodeId));
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
    // Build edges and update tiles
    tiles.forEach(tile => {
        if (tile.nodes.length === 0)
            return;
        // Build edges list using the angular-ordered nodes
        const tileEdges = [];
        for (let i = 0; i < tile.nodes.length; i++) {
            const nodeA = tile.nodes[i];
            const nodeB = tile.nodes[(i + 1) % tile.nodes.length];
            // Find edge connecting these consecutive nodes
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