// Map validation functions
export function validateMap(mapData) {
    const errors = [];
    const { tiles, nodes, edges } = mapData;
    // Create lookup maps
    const tileMap = new Map(tiles.map(t => [t.id, t]));
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const edgeMap = new Map(edges.map(e => [e.id, e]));
    // 1. Check that all tiles, nodes, and edges have unique IDs
    if (new Set(tiles.map(t => t.id)).size !== tiles.length) {
        errors.push('Duplicate tile IDs found');
    }
    if (new Set(nodes.map(n => n.id)).size !== nodes.length) {
        errors.push('Duplicate node IDs found');
    }
    if (new Set(edges.map(e => e.id)).size !== edges.length) {
        errors.push('Duplicate edge IDs found');
    }
    // 2. CRITICAL: Verify vertex-degree invariant (each node touches at least 1 and at most 3 tiles)
    // Note: Boundary nodes may touch fewer than 3 tiles in bounded maps
    nodes.forEach(node => {
        if (node.tiles.length < 1 || node.tiles.length > 3) {
            errors.push(`Node ${node.id} has invalid tile count: ${node.tiles.length} (must be 1-3)`);
        }
        // Verify referenced tiles exist
        node.tiles.forEach(tileId => {
            if (!tileMap.has(tileId)) {
                errors.push(`Node ${node.id} references non-existent tile ${tileId}`);
            }
        });
    });
    // 3. Verify tile references
    tiles.forEach(tile => {
        // Check nodes exist and reference back to this tile
        tile.nodes.forEach(nodeId => {
            const node = nodeMap.get(nodeId);
            if (!node) {
                errors.push(`Tile ${tile.id} references non-existent node ${nodeId}`);
            }
            else if (!node.tiles.includes(tile.id)) {
                errors.push(`Tile ${tile.id} references node ${nodeId}, but node doesn't reference tile back`);
            }
        });
        // Check edges exist
        tile.edges.forEach(edgeId => {
            if (!edgeMap.has(edgeId)) {
                errors.push(`Tile ${tile.id} references non-existent edge ${edgeId}`);
            }
        });
        // Verify tile shape matches number of nodes/edges
        // Boundary tiles can have fewer edges/nodes than their shape suggests
        if (!tile.isBoundary) {
            if (tile.nodes.length !== tile.shape) {
                errors.push(`Tile ${tile.id} has shape ${tile.shape} but ${tile.nodes.length} nodes`);
            }
            if (tile.edges.length !== tile.shape) {
                errors.push(`Tile ${tile.id} has shape ${tile.shape} but ${tile.edges.length} edges`);
            }
        }
        else {
            // Boundary tiles should have at least 3 nodes/edges
            if (tile.nodes.length < 3) {
                errors.push(`Boundary tile ${tile.id} has ${tile.nodes.length} nodes (must be >= 3)`);
            }
            if (tile.edges.length < 3) {
                errors.push(`Boundary tile ${tile.id} has ${tile.edges.length} edges (must be >= 3)`);
            }
        }
        // Verify polygon has at least 3 sides
        if (tile.shape < 3) {
            errors.push(`Tile ${tile.id} has invalid shape ${tile.shape} (must be >= 3)`);
        }
    });
    // 4. Verify edge references
    edges.forEach(edge => {
        // Check nodes exist
        const nodeA = nodeMap.get(edge.nodeA);
        const nodeB = nodeMap.get(edge.nodeB);
        if (!nodeA) {
            errors.push(`Edge ${edge.id} references non-existent node ${edge.nodeA}`);
        }
        if (!nodeB) {
            errors.push(`Edge ${edge.id} references non-existent node ${edge.nodeB}`);
        }
        // Check tiles exist
        if (edge.tileLeft && !tileMap.has(edge.tileLeft)) {
            errors.push(`Edge ${edge.id} references non-existent tile ${edge.tileLeft}`);
        }
        if (edge.tileRight && !tileMap.has(edge.tileRight)) {
            errors.push(`Edge ${edge.id} references non-existent tile ${edge.tileRight}`);
        }
        // Verify nodes are different
        if (edge.nodeA === edge.nodeB) {
            errors.push(`Edge ${edge.id} has same node for both endpoints`);
        }
    });
    // 5. Verify connectivity - all tiles should be reachable from any tile
    if (tiles.length > 0) {
        const visited = new Set();
        const queue = [tiles[0].id];
        visited.add(tiles[0].id);
        while (queue.length > 0) {
            const currentId = queue.shift();
            const current = tileMap.get(currentId);
            // Find adjacent tiles through shared nodes
            const adjacentTiles = new Set();
            current.nodes.forEach(nodeId => {
                const node = nodeMap.get(nodeId);
                if (node) {
                    node.tiles.forEach(tileId => {
                        if (tileId !== currentId) {
                            adjacentTiles.add(tileId);
                        }
                    });
                }
            });
            adjacentTiles.forEach(tileId => {
                if (!visited.has(tileId)) {
                    visited.add(tileId);
                    queue.push(tileId);
                }
            });
        }
        if (visited.size !== tiles.length) {
            errors.push(`Map is not fully connected: ${visited.size}/${tiles.length} tiles reachable`);
        }
    }
    // 6. Verify no duplicate edges
    const edgePairs = new Set();
    edges.forEach(edge => {
        const pair1 = `${edge.nodeA}-${edge.nodeB}`;
        const pair2 = `${edge.nodeB}-${edge.nodeA}`;
        if (edgePairs.has(pair1) || edgePairs.has(pair2)) {
            errors.push(`Duplicate edge found between nodes ${edge.nodeA} and ${edge.nodeB}`);
        }
        edgePairs.add(pair1);
    });
    return {
        valid: errors.length === 0,
        errors
    };
}
export function validateMapOrThrow(mapData) {
    const result = validateMap(mapData);
    if (!result.valid) {
        throw new Error(`Map validation failed:\n${result.errors.join('\n')}`);
    }
}
// Helper to check if two nodes are adjacent (share an edge)
export function areNodesAdjacent(nodeA, nodeB, edges) {
    return edges.some(e => (e.nodeA === nodeA && e.nodeB === nodeB) ||
        (e.nodeA === nodeB && e.nodeB === nodeA));
}
// Helper to get adjacent nodes
export function getAdjacentNodes(nodeId, edges) {
    const adjacent = [];
    edges.forEach(edge => {
        if (edge.nodeA === nodeId) {
            adjacent.push(edge.nodeB);
        }
        else if (edge.nodeB === nodeId) {
            adjacent.push(edge.nodeA);
        }
    });
    return adjacent;
}
// Helper to get edges connected to a node
export function getNodeEdges(nodeId, edges) {
    return edges.filter(e => e.nodeA === nodeId || e.nodeB === nodeId);
}
// Helper to find edge between two nodes
export function findEdge(nodeA, nodeB, edges) {
    return edges.find(e => (e.nodeA === nodeA && e.nodeB === nodeB) ||
        (e.nodeA === nodeB && e.nodeB === nodeA));
}
//# sourceMappingURL=validator.js.map