// Robber and knight mechanics
import { ROBBER_DISCARD_THRESHOLD } from '../models/types.js';
import { generateId } from './utils.js';
export function handleRobberActivation(state) {
    const newState = JSON.parse(JSON.stringify(state));
    // Players with > 7 cards must discard half
    newState.players.forEach(player => {
        const totalCards = Object.values(player.resources).reduce((sum, count) => sum + count, 0);
        if (totalCards > ROBBER_DISCARD_THRESHOLD) {
            const toDiscard = Math.floor(totalCards / 2);
            // In a real game, player chooses which cards to discard
            // For now, discard randomly
            let discarded = 0;
            const resources = Object.keys(player.resources);
            while (discarded < toDiscard) {
                const resource = resources[Math.floor(Math.random() * resources.length)];
                if (player.resources[resource] > 0) {
                    player.resources[resource]--;
                    discarded++;
                }
            }
        }
    });
    return newState;
}
export function moveRobber(state, playerId, targetTileId, stealFromPlayerId) {
    const newState = JSON.parse(JSON.stringify(state));
    // Remove robber from current tile
    if (newState.robberTileId) {
        const currentTile = newState.tiles.find(t => t.id === newState.robberTileId);
        if (currentTile) {
            currentTile.robberPresent = false;
        }
    }
    // Place robber on new tile
    const targetTile = newState.tiles.find(t => t.id === targetTileId);
    if (!targetTile) {
        throw new Error('Target tile not found');
    }
    targetTile.robberPresent = true;
    newState.robberTileId = targetTileId;
    // Steal a resource if specified
    if (stealFromPlayerId) {
        const victim = newState.players.find(p => p.id === stealFromPlayerId);
        const thief = newState.players.find(p => p.id === playerId);
        if (victim && thief) {
            // Get victim's resources
            const availableResources = Object.entries(victim.resources)
                .filter(([_, count]) => count > 0)
                .map(([resource]) => resource);
            if (availableResources.length > 0) {
                // Steal random resource
                const stolenResource = availableResources[Math.floor(Math.random() * availableResources.length)];
                victim.resources[stolenResource]--;
                thief.resources[stolenResource]++;
            }
        }
    }
    return newState;
}
export function playKnight(state, playerId, nodeId, newRobberTileId, stealFromPlayerId) {
    let newState = JSON.parse(JSON.stringify(state));
    const player = newState.players.find(p => p.id === playerId);
    if (!player) {
        throw new Error('Player not found');
    }
    // Move robber
    newState = moveRobber(newState, playerId, newRobberTileId, stealFromPlayerId);
    // If enhanced knights enabled, place knight on board
    if (state.options.enhancedKnights) {
        const knight = {
            id: generateId('knight'),
            ownerId: playerId,
            nodeId,
            active: true
        };
        newState.knights.push(knight);
        player.knights.push(knight.id);
    }
    // Increment army size
    player.armySize++;
    // Check for largest army
    updateLargestArmy(newState);
    return newState;
}
export function updateLargestArmy(state) {
    const MIN_ARMY = 3;
    let largestSize = MIN_ARMY - 1;
    let largestOwner = null;
    state.players.forEach(player => {
        if (player.armySize > largestSize) {
            largestSize = player.armySize;
            largestOwner = player.id;
        }
        else if (player.armySize === largestSize && largestSize >= MIN_ARMY) {
            // Tie - check who had it first
            if (state.largestArmyOwner === player.id) {
                largestOwner = player.id;
            }
        }
    });
    // Update ownership and victory points
    if (largestOwner !== state.largestArmyOwner) {
        // Remove from previous owner
        if (state.largestArmyOwner) {
            const prevOwner = state.players.find(p => p.id === state.largestArmyOwner);
            if (prevOwner) {
                prevOwner.victoryPoints -= 2;
            }
        }
        // Add to new owner
        if (largestOwner) {
            const newOwner = state.players.find(p => p.id === largestOwner);
            if (newOwner) {
                newOwner.victoryPoints += 2;
            }
        }
        state.largestArmyOwner = largestOwner;
    }
}
export function getPlayersOnTile(state, tileId) {
    const tile = state.tiles.find(t => t.id === tileId);
    if (!tile)
        return [];
    const players = new Set();
    tile.nodes.forEach(nodeId => {
        const node = state.nodes.find(n => n.id === nodeId);
        if (node?.occupant) {
            players.add(node.occupant.playerId);
        }
    });
    return Array.from(players);
}
//# sourceMappingURL=robber.js.map