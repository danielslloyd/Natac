// Military game mode implementation
import { Resource, BUILDING_COSTS, MAINTENANCE_COSTS } from '../models/types.js';
import { generateId } from './utils.js';
// Helper function to check if player has required resources
function hasResources(player, cost) {
    for (const [resource, amount] of Object.entries(cost)) {
        if (amount && player.resources[resource] < amount) {
            return false;
        }
    }
    return true;
}
// Helper function to deduct resources from player
function deductResources(player, cost) {
    for (const [resource, amount] of Object.entries(cost)) {
        if (amount) {
            player.resources[resource] -= amount;
        }
    }
}
// Check if a tile is a water tile
function isWaterTile(tile) {
    // Water tiles have no dice number and no resource (or DESERT resource for ocean)
    // This is a simple heuristic - adjust based on your map generation
    return tile.resource === Resource.DESERT && tile.diceNumber === null;
}
// Get tiles adjacent to a tile
function getAdjacentTiles(tileId, tiles, edges) {
    const tile = tiles.find(t => t.id === tileId);
    if (!tile)
        return [];
    const adjacentTileIds = new Set();
    // Find all edges of this tile
    for (const edgeId of tile.edges) {
        const edge = edges.find(e => e.id === edgeId);
        if (!edge)
            continue;
        // Add the tiles on either side of the edge (excluding the current tile)
        if (edge.tileLeft && edge.tileLeft !== tileId) {
            adjacentTileIds.add(edge.tileLeft);
        }
        if (edge.tileRight && edge.tileRight !== tileId) {
            adjacentTileIds.add(edge.tileRight);
        }
    }
    return Array.from(adjacentTileIds);
}
// Get tiles adjacent to a node
function getTilesAdjacentToNode(nodeId, nodes) {
    const node = nodes.find(n => n.id === nodeId);
    return node ? node.tiles : [];
}
// BFS to check if there's a supply path from settlements/cities to a tile vertex via wagons
function isKnightSupplied(knightTileId, ownerId, state) {
    const { nodes, edges, wagons = [], tiles } = state;
    const player = state.players.find(p => p.id === ownerId);
    if (!player)
        return false;
    // Get all nodes of the knight's tile
    const knightTile = tiles.find(t => t.id === knightTileId);
    if (!knightTile)
        return false;
    const knightNodes = knightTile.nodes;
    // Get all settlement and city nodes for this player
    const baseNodes = new Set([...player.settlements, ...player.cities]);
    // BFS from each base node to see if we can reach any knight node via wagons
    for (const baseNodeId of baseNodes) {
        const visited = new Set();
        const queue = [baseNodeId];
        visited.add(baseNodeId);
        while (queue.length > 0) {
            const currentNode = queue.shift();
            // Check if we've reached one of the knight's tile vertices
            if (knightNodes.includes(currentNode)) {
                return true;
            }
            // Find all edges with wagons owned by this player
            const playerWagons = wagons.filter(w => w.ownerId === ownerId);
            for (const wagon of playerWagons) {
                const edge = edges.find(e => e.id === wagon.edgeId);
                if (!edge)
                    continue;
                // Check if this wagon's edge connects to current node
                let nextNode = null;
                if (edge.nodeA === currentNode && !visited.has(edge.nodeB)) {
                    nextNode = edge.nodeB;
                }
                else if (edge.nodeB === currentNode && !visited.has(edge.nodeA)) {
                    nextNode = edge.nodeA;
                }
                if (nextNode) {
                    visited.add(nextNode);
                    queue.push(nextNode);
                }
            }
            // Also allow traversal via player's roads
            const playerRoadEdges = edges.filter(e => e.roadOwner === ownerId);
            for (const edge of playerRoadEdges) {
                let nextNode = null;
                if (edge.nodeA === currentNode && !visited.has(edge.nodeB)) {
                    nextNode = edge.nodeB;
                }
                else if (edge.nodeB === currentNode && !visited.has(edge.nodeA)) {
                    nextNode = edge.nodeA;
                }
                if (nextNode) {
                    visited.add(nextNode);
                    queue.push(nextNode);
                }
            }
        }
    }
    return false;
}
// Update supply status for all knights
export function updateKnightSupplyStatus(state) {
    if (!state.militaryKnights)
        return;
    for (const knight of state.militaryKnights) {
        // Skip knights being carried by fleets
        if (knight.carriedByFleetId) {
            knight.supplied = false;
            continue;
        }
        knight.supplied = isKnightSupplied(knight.tileId, knight.ownerId, state);
        // Only block production if supplied
        knight.blockingProduction = knight.supplied;
    }
}
// Purchase and deploy a military knight
export function purchaseMilitaryKnight(state, playerId, tileId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const player = state.players.find(p => p.id === playerId);
    if (!player) {
        return { ok: false, reason: 'Player not found' };
    }
    const tile = state.tiles.find(t => t.id === tileId);
    if (!tile) {
        return { ok: false, reason: 'Tile not found' };
    }
    // Cannot deploy on water tiles
    if (isWaterTile(tile)) {
        return { ok: false, reason: 'Cannot deploy knight on water tile' };
    }
    // Check if player has resources
    const cost = BUILDING_COSTS.militaryKnight;
    if (!hasResources(player, cost)) {
        return { ok: false, reason: 'Insufficient resources' };
    }
    // Check if tile already has a knight
    if (state.militaryKnights?.some(k => k.tileId === tileId)) {
        return { ok: false, reason: 'Tile already has a knight' };
    }
    // Create the knight
    const knight = {
        id: generateId(),
        ownerId: playerId,
        tileId,
        supplied: false,
        hasMoved: false,
        blockingProduction: false
    };
    // Initialize arrays if needed
    if (!state.militaryKnights)
        state.militaryKnights = [];
    if (!player.militaryKnights)
        player.militaryKnights = [];
    state.militaryKnights.push(knight);
    player.militaryKnights.push(knight.id);
    // Deduct resources
    deductResources(player, cost);
    // Update supply status
    updateKnightSupplyStatus(state);
    return { ok: true };
}
// Place a wagon on an edge
export function placeWagon(state, playerId, edgeId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const player = state.players.find(p => p.id === playerId);
    if (!player) {
        return { ok: false, reason: 'Player not found' };
    }
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) {
        return { ok: false, reason: 'Edge not found' };
    }
    // Check if player has resources
    const cost = BUILDING_COSTS.wagon;
    if (!hasResources(player, cost)) {
        return { ok: false, reason: 'Insufficient resources' };
    }
    // Check if edge already has a wagon or road
    if (state.wagons?.some(w => w.edgeId === edgeId)) {
        return { ok: false, reason: 'Edge already has a wagon' };
    }
    if (edge.roadOwner !== null && edge.roadOwner !== undefined) {
        return { ok: false, reason: 'Edge already has a road' };
    }
    // Create the wagon
    const wagon = {
        id: generateId(),
        ownerId: playerId,
        edgeId,
        hasBeenRepositioned: false
    };
    // Initialize arrays if needed
    if (!state.wagons)
        state.wagons = [];
    if (!player.wagons)
        player.wagons = [];
    state.wagons.push(wagon);
    player.wagons.push(wagon.id);
    // Deduct resources
    deductResources(player, cost);
    // Update knight supply status
    updateKnightSupplyStatus(state);
    return { ok: true };
}
// Reposition a wagon (move it to a different edge)
export function repositionWagon(state, playerId, wagonId, newEdgeId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const wagon = state.wagons?.find(w => w.id === wagonId);
    if (!wagon) {
        return { ok: false, reason: 'Wagon not found' };
    }
    if (wagon.ownerId !== playerId) {
        return { ok: false, reason: 'Not your wagon' };
    }
    if (wagon.hasBeenRepositioned) {
        return { ok: false, reason: 'Wagon already repositioned this turn' };
    }
    const newEdge = state.edges.find(e => e.id === newEdgeId);
    if (!newEdge) {
        return { ok: false, reason: 'Edge not found' };
    }
    // Check if new edge is available
    if (state.wagons?.some(w => w.edgeId === newEdgeId)) {
        return { ok: false, reason: 'Edge already has a wagon' };
    }
    if (newEdge.roadOwner !== null && newEdge.roadOwner !== undefined) {
        return { ok: false, reason: 'Edge already has a road' };
    }
    // Move the wagon
    wagon.edgeId = newEdgeId;
    wagon.hasBeenRepositioned = true;
    // Update knight supply status
    updateKnightSupplyStatus(state);
    return { ok: true };
}
// Build a fleet on a water tile
export function buildFleet(state, playerId, tileId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const player = state.players.find(p => p.id === playerId);
    if (!player) {
        return { ok: false, reason: 'Player not found' };
    }
    const tile = state.tiles.find(t => t.id === tileId);
    if (!tile) {
        return { ok: false, reason: 'Tile not found' };
    }
    // Must be a water tile
    if (!isWaterTile(tile)) {
        return { ok: false, reason: 'Can only build fleet on water tile' };
    }
    // Check if player has resources
    const cost = BUILDING_COSTS.fleet;
    if (!hasResources(player, cost)) {
        return { ok: false, reason: 'Insufficient resources' };
    }
    // Check if tile already has a fleet
    if (state.fleets?.some(f => f.tileId === tileId)) {
        return { ok: false, reason: 'Tile already has a fleet' };
    }
    // Create the fleet
    const fleet = {
        id: generateId(),
        ownerId: playerId,
        tileId,
        hasMoved: false
    };
    // Initialize arrays if needed
    if (!state.fleets)
        state.fleets = [];
    if (!player.fleets)
        player.fleets = [];
    state.fleets.push(fleet);
    player.fleets.push(fleet.id);
    // Deduct resources
    deductResources(player, cost);
    return { ok: true };
}
// Move a military knight to an adjacent tile
export function moveMilitaryKnight(state, playerId, knightId, targetTileId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const knight = state.militaryKnights?.find(k => k.id === knightId);
    if (!knight) {
        return { ok: false, reason: 'Knight not found' };
    }
    if (knight.ownerId !== playerId) {
        return { ok: false, reason: 'Not your knight' };
    }
    if (knight.hasMoved) {
        return { ok: false, reason: 'Knight already moved this turn' };
    }
    if (knight.carriedByFleetId) {
        return { ok: false, reason: 'Knight is being carried by a fleet' };
    }
    const targetTile = state.tiles.find(t => t.id === targetTileId);
    if (!targetTile) {
        return { ok: false, reason: 'Target tile not found' };
    }
    // Cannot move to water tile
    if (isWaterTile(targetTile)) {
        return { ok: false, reason: 'Cannot move knight to water tile' };
    }
    // Check if target is adjacent
    const adjacentTiles = getAdjacentTiles(knight.tileId, state.tiles, state.edges);
    if (!adjacentTiles.includes(targetTileId)) {
        return { ok: false, reason: 'Target tile is not adjacent' };
    }
    // Check if target tile already has a knight
    if (state.militaryKnights?.some(k => k.tileId === targetTileId)) {
        return { ok: false, reason: 'Target tile already has a knight' };
    }
    // Move the knight
    knight.tileId = targetTileId;
    knight.hasMoved = true;
    // Update supply status
    updateKnightSupplyStatus(state);
    return { ok: true };
}
// Move a fleet to an adjacent water tile
export function moveFleet(state, playerId, fleetId, targetTileId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const fleet = state.fleets?.find(f => f.id === fleetId);
    if (!fleet) {
        return { ok: false, reason: 'Fleet not found' };
    }
    if (fleet.ownerId !== playerId) {
        return { ok: false, reason: 'Not your fleet' };
    }
    if (fleet.hasMoved) {
        return { ok: false, reason: 'Fleet already moved this turn' };
    }
    const targetTile = state.tiles.find(t => t.id === targetTileId);
    if (!targetTile) {
        return { ok: false, reason: 'Target tile not found' };
    }
    // Must be a water tile
    if (!isWaterTile(targetTile)) {
        return { ok: false, reason: 'Fleet can only move to water tiles' };
    }
    // Check if target is adjacent
    const adjacentTiles = getAdjacentTiles(fleet.tileId, state.tiles, state.edges);
    if (!adjacentTiles.includes(targetTileId)) {
        return { ok: false, reason: 'Target tile is not adjacent' };
    }
    // Check if target tile already has a fleet
    if (state.fleets?.some(f => f.tileId === targetTileId)) {
        return { ok: false, reason: 'Target tile already has a fleet' };
    }
    // Move the fleet (and any carried knight)
    fleet.tileId = targetTileId;
    fleet.hasMoved = true;
    return { ok: true };
}
// Load a knight onto a fleet
export function loadKnightOntoFleet(state, playerId, knightId, fleetId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const knight = state.militaryKnights?.find(k => k.id === knightId);
    if (!knight) {
        return { ok: false, reason: 'Knight not found' };
    }
    if (knight.ownerId !== playerId) {
        return { ok: false, reason: 'Not your knight' };
    }
    const fleet = state.fleets?.find(f => f.id === fleetId);
    if (!fleet) {
        return { ok: false, reason: 'Fleet not found' };
    }
    if (fleet.ownerId !== playerId) {
        return { ok: false, reason: 'Not your fleet' };
    }
    if (fleet.carryingKnightId) {
        return { ok: false, reason: 'Fleet already carrying a knight' };
    }
    if (knight.carriedByFleetId) {
        return { ok: false, reason: 'Knight already on a fleet' };
    }
    // Check if knight tile is adjacent to fleet tile
    const adjacentTiles = getAdjacentTiles(fleet.tileId, state.tiles, state.edges);
    if (!adjacentTiles.includes(knight.tileId)) {
        return { ok: false, reason: 'Knight must be adjacent to fleet' };
    }
    // Load the knight
    fleet.carryingKnightId = knight.id;
    knight.carriedByFleetId = fleet.id;
    knight.supplied = false; // Knights on fleets are not supplied
    knight.blockingProduction = false;
    return { ok: true };
}
// Unload a knight from a fleet
export function unloadKnightFromFleet(state, playerId, fleetId, targetTileId) {
    if (!state.options.militaryMode) {
        return { ok: false, reason: 'Military mode is not enabled' };
    }
    const fleet = state.fleets?.find(f => f.id === fleetId);
    if (!fleet) {
        return { ok: false, reason: 'Fleet not found' };
    }
    if (fleet.ownerId !== playerId) {
        return { ok: false, reason: 'Not your fleet' };
    }
    if (!fleet.carryingKnightId) {
        return { ok: false, reason: 'Fleet is not carrying a knight' };
    }
    const knight = state.militaryKnights?.find(k => k.id === fleet.carryingKnightId);
    if (!knight) {
        return { ok: false, reason: 'Knight not found' };
    }
    const targetTile = state.tiles.find(t => t.id === targetTileId);
    if (!targetTile) {
        return { ok: false, reason: 'Target tile not found' };
    }
    // Cannot unload to water tile
    if (isWaterTile(targetTile)) {
        return { ok: false, reason: 'Cannot unload knight to water tile' };
    }
    // Target must be adjacent to fleet
    const adjacentTiles = getAdjacentTiles(fleet.tileId, state.tiles, state.edges);
    if (!adjacentTiles.includes(targetTileId)) {
        return { ok: false, reason: 'Target tile must be adjacent to fleet' };
    }
    // Check if target tile already has a knight
    if (state.militaryKnights?.some(k => k.tileId === targetTileId)) {
        return { ok: false, reason: 'Target tile already has a knight' };
    }
    // Unload the knight
    knight.tileId = targetTileId;
    knight.carriedByFleetId = undefined;
    fleet.carryingKnightId = undefined;
    // Update supply status
    updateKnightSupplyStatus(state);
    return { ok: true };
}
// Check if a settlement/city is surrounded by knights
function isSurrounded(nodeId, attackerId, state) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node)
        return false;
    const { tiles, militaryKnights = [] } = state;
    // Get all land tiles adjacent to this node
    const adjacentLandTiles = node.tiles.filter(tileId => {
        const tile = tiles.find(t => t.id === tileId);
        return tile && !isWaterTile(tile);
    });
    if (adjacentLandTiles.length === 0)
        return false;
    // Check if all adjacent land tiles have knights from the attacker
    for (const tileId of adjacentLandTiles) {
        const hasAttackerKnight = militaryKnights.some(k => k.tileId === tileId && k.ownerId === attackerId && k.supplied);
        if (!hasAttackerKnight) {
            return false;
        }
    }
    return true;
}
// Update capture progress for all settlements/cities
export function updateCaptureProgress(state) {
    if (!state.options.militaryMode)
        return;
    if (!state.captureProgress)
        state.captureProgress = [];
    const { nodes, players } = state;
    // Check all occupied nodes
    for (const node of nodes) {
        if (!node.occupant)
            continue;
        const defenderId = node.occupant.playerId;
        const requiredTurns = node.occupant.type === 'settlement' ? 3 : 6;
        // Check each other player to see if they're surrounding this node
        for (const player of players) {
            if (player.id === defenderId)
                continue;
            const surrounded = isSurrounded(node.id, player.id, state);
            // Find existing capture progress
            const existingProgress = state.captureProgress.find(cp => cp.nodeId === node.id && cp.attackerId === player.id);
            if (surrounded) {
                if (existingProgress) {
                    // Increment progress
                    existingProgress.turnsHeld++;
                    // Check if capture is complete
                    if (existingProgress.turnsHeld >= requiredTurns) {
                        captureSettlement(state, node.id, player.id);
                        // Remove this capture progress
                        state.captureProgress = state.captureProgress.filter(cp => !(cp.nodeId === node.id && cp.attackerId === player.id));
                    }
                }
                else {
                    // Start new capture progress
                    state.captureProgress.push({
                        nodeId: node.id,
                        attackerId: player.id,
                        turnsHeld: 1,
                        requiredTurns
                    });
                }
            }
            else if (existingProgress) {
                // No longer surrounded - reset progress
                state.captureProgress = state.captureProgress.filter(cp => !(cp.nodeId === node.id && cp.attackerId === player.id));
            }
        }
    }
}
// Capture a settlement or city
function captureSettlement(state, nodeId, attackerId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node || !node.occupant)
        return;
    const defender = state.players.find(p => p.id === node.occupant.playerId);
    const attacker = state.players.find(p => p.id === attackerId);
    if (!defender || !attacker)
        return;
    const isCity = node.occupant.type === 'city';
    // Remove from defender
    if (isCity) {
        defender.cities = defender.cities.filter(id => id !== nodeId);
        defender.victoryPoints -= 2;
    }
    else {
        defender.settlements = defender.settlements.filter(id => id !== nodeId);
        defender.victoryPoints -= 1;
    }
    // Add to attacker
    if (isCity) {
        attacker.cities.push(nodeId);
        attacker.victoryPoints += 2;
    }
    else {
        attacker.settlements.push(nodeId);
        attacker.victoryPoints += 1;
    }
    // Update node occupant
    node.occupant = {
        playerId: attackerId,
        type: node.occupant.type
    };
}
// Collect maintenance costs at start of turn
export function collectMaintenanceCosts(state, playerId) {
    if (!state.options.militaryMode) {
        return { ok: true };
    }
    const player = state.players.find(p => p.id === playerId);
    if (!player) {
        return { ok: false, reason: 'Player not found' };
    }
    // Calculate total maintenance
    const totalCost = {
        [Resource.ORE]: 0,
        [Resource.SHEEP]: 0,
        [Resource.WOOD]: 0,
        [Resource.BRICK]: 0,
        [Resource.WHEAT]: 0,
        [Resource.DESERT]: 0
    };
    // Knights maintenance
    const knightCount = player.militaryKnights?.length || 0;
    for (const [resource, amount] of Object.entries(MAINTENANCE_COSTS.militaryKnight)) {
        totalCost[resource] += amount * knightCount;
    }
    // Wagons maintenance
    const wagonCount = player.wagons?.length || 0;
    for (const [resource, amount] of Object.entries(MAINTENANCE_COSTS.wagon)) {
        totalCost[resource] += amount * wagonCount;
    }
    // Fleets maintenance
    const fleetCount = player.fleets?.length || 0;
    for (const [resource, amount] of Object.entries(MAINTENANCE_COSTS.fleet)) {
        totalCost[resource] += amount * fleetCount;
    }
    // Check if player can afford
    if (!hasResources(player, totalCost)) {
        return { ok: false, reason: 'Cannot afford maintenance costs' };
    }
    // Deduct maintenance
    deductResources(player, totalCost);
    return { ok: true };
}
// Reset movement flags at start of turn
export function resetMovementFlags(state) {
    if (!state.options.militaryMode)
        return;
    // Reset knight movement
    if (state.militaryKnights) {
        for (const knight of state.militaryKnights) {
            knight.hasMoved = false;
        }
    }
    // Reset fleet movement
    if (state.fleets) {
        for (const fleet of state.fleets) {
            fleet.hasMoved = false;
        }
    }
    // Reset wagon reposition
    if (state.wagons) {
        for (const wagon of state.wagons) {
            wagon.hasBeenRepositioned = false;
        }
    }
}
//# sourceMappingURL=military.js.map