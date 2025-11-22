// Core game logic and state management
import { Resource as ResourceEnum, BUILDING_COSTS } from '../models/types.js';
import { generateMap } from '../map/index.js';
import { generateId, SeededRandom } from './utils.js';
import { getAdjacentNodes } from '../map/validator.js';
export function createGame(playerNames, options) {
    if (playerNames.length < 2 || playerNames.length > 6) {
        throw new Error('Game requires 2-6 players');
    }
    const gameId = generateId('game');
    // Create players
    const players = playerNames.map((name, idx) => ({
        id: generateId('player'),
        name,
        color: ['red', 'blue', 'white', 'orange', 'green', 'brown'][idx],
        resources: {
            [ResourceEnum.ORE]: 0,
            [ResourceEnum.SHEEP]: 0,
            [ResourceEnum.WOOD]: 0,
            [ResourceEnum.BRICK]: 0,
            [ResourceEnum.WHEAT]: 0,
            [ResourceEnum.DESERT]: 0
        },
        futureResources: {
            [ResourceEnum.ORE]: 0,
            [ResourceEnum.SHEEP]: 0,
            [ResourceEnum.WOOD]: 0,
            [ResourceEnum.BRICK]: 0,
            [ResourceEnum.WHEAT]: 0,
            [ResourceEnum.DESERT]: 0
        },
        roads: [],
        settlements: [],
        cities: [],
        knights: [],
        victoryPoints: 0,
        longestRoadLength: 0,
        armySize: 0,
        isAI: false
    }));
    // Generate map
    const mapData = generateMap(options);
    // Find robber starting position (desert)
    const desertTile = mapData.tiles.find(t => t.resource === ResourceEnum.DESERT);
    const robberTileId = desertTile?.id || mapData.tiles[0].id;
    // Initialize game state
    const gameState = {
        id: gameId,
        players,
        bank: {
            [ResourceEnum.ORE]: 19,
            [ResourceEnum.SHEEP]: 19,
            [ResourceEnum.WOOD]: 19,
            [ResourceEnum.BRICK]: 19,
            [ResourceEnum.WHEAT]: 19,
            [ResourceEnum.DESERT]: 0
        },
        tiles: mapData.tiles,
        nodes: mapData.nodes,
        edges: mapData.edges,
        knights: [],
        turnOrder: players.map(p => p.id),
        currentPlayerIdx: 0,
        phase: 'setup',
        setupPhase: {
            round: 0,
            settlementsPlaced: 0
        },
        tradeProposals: [],
        diceHistory: [],
        robberTileId,
        longestRoadOwner: null,
        largestArmyOwner: null,
        seed: options.seed,
        options
    };
    return gameState;
}
export function rollDice(rng) {
    const random = rng || new SeededRandom();
    const die1 = random.nextInt(1, 6);
    const die2 = random.nextInt(1, 6);
    return die1 + die2;
}
export function validateAction(state, action) {
    const player = state.players.find(p => p.id === action.playerId);
    if (!player) {
        return { ok: false, reason: 'Player not found' };
    }
    switch (action.type) {
        case 'placeSettlement':
            return validatePlaceSettlement(state, player, action.payload.nodeId);
        case 'placeRoad':
            return validatePlaceRoad(state, player, action.payload.edgeId);
        case 'upgradeToCity':
            return validateUpgradeToCity(state, player, action.payload.nodeId);
        case 'buyDevelopmentCard':
            return validateBuyDevelopmentCard(state, player);
        default:
            return { ok: false, reason: 'Unknown action type' };
    }
}
function validatePlaceSettlement(state, player, nodeId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) {
        return { ok: false, reason: 'Node not found' };
    }
    // Check if node is occupied
    if (node.occupant) {
        return { ok: false, reason: 'Node already occupied' };
    }
    // Check distance rule: adjacent nodes must be empty
    const adjacentNodes = getAdjacentNodes(nodeId, state.edges);
    for (const adjId of adjacentNodes) {
        const adjNode = state.nodes.find(n => n.id === adjId);
        if (adjNode?.occupant) {
            return { ok: false, reason: 'Too close to another settlement' };
        }
    }
    // In main phase, must be connected to a road
    if (state.phase === 'main') {
        const hasConnectedRoad = state.edges.some(e => (e.nodeA === nodeId || e.nodeB === nodeId) && e.roadOwner === player.id);
        if (!hasConnectedRoad) {
            return { ok: false, reason: 'Must be connected to your road' };
        }
        // Check resources
        if (!hasResources(player, BUILDING_COSTS.settlement)) {
            return { ok: false, reason: 'Insufficient resources' };
        }
    }
    return { ok: true };
}
function validatePlaceRoad(state, player, edgeId) {
    const edge = state.edges.find(e => e.id === edgeId);
    if (!edge) {
        return { ok: false, reason: 'Edge not found' };
    }
    // Check if edge is occupied
    if (edge.roadOwner) {
        return { ok: false, reason: 'Road already placed here' };
    }
    // Must connect to player's existing road or settlement
    if (state.phase === 'main' || player.roads.length > 0) {
        const nodeAHasConnection = state.nodes.find(n => n.id === edge.nodeA)?.occupant?.playerId === player.id ||
            state.edges.some(e => e.id !== edgeId &&
                (e.nodeA === edge.nodeA || e.nodeB === edge.nodeA) &&
                e.roadOwner === player.id);
        const nodeBHasConnection = state.nodes.find(n => n.id === edge.nodeB)?.occupant?.playerId === player.id ||
            state.edges.some(e => e.id !== edgeId &&
                (e.nodeA === edge.nodeB || e.nodeB === edge.nodeB) &&
                e.roadOwner === player.id);
        if (!nodeAHasConnection && !nodeBHasConnection) {
            return { ok: false, reason: 'Road must connect to your network' };
        }
    }
    // Check resources in main phase
    if (state.phase === 'main') {
        if (!hasResources(player, BUILDING_COSTS.road)) {
            return { ok: false, reason: 'Insufficient resources' };
        }
    }
    return { ok: true };
}
function validateUpgradeToCity(state, player, nodeId) {
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) {
        return { ok: false, reason: 'Node not found' };
    }
    if (!node.occupant || node.occupant.playerId !== player.id) {
        return { ok: false, reason: 'You do not own this settlement' };
    }
    if (node.occupant.type !== 'settlement') {
        return { ok: false, reason: 'Already a city' };
    }
    if (!hasResources(player, BUILDING_COSTS.city)) {
        return { ok: false, reason: 'Insufficient resources' };
    }
    return { ok: true };
}
function validateBuyDevelopmentCard(state, player) {
    if (!hasResources(player, BUILDING_COSTS.developmentCard)) {
        return { ok: false, reason: 'Insufficient resources' };
    }
    return { ok: true };
}
function hasResources(player, cost) {
    for (const [resource, amount] of Object.entries(cost)) {
        if (player.resources[resource] < amount) {
            return false;
        }
    }
    return true;
}
function deductResources(player, cost) {
    for (const [resource, amount] of Object.entries(cost)) {
        player.resources[resource] -= amount;
    }
}
export function applyAction(state, action) {
    // Validate first
    const validation = validateAction(state, action);
    if (!validation.ok) {
        throw new Error(`Invalid action: ${validation.reason}`);
    }
    // Clone state for immutability
    const newState = JSON.parse(JSON.stringify(state));
    const player = newState.players.find(p => p.id === action.playerId);
    switch (action.type) {
        case 'placeSettlement': {
            const nodeId = action.payload.nodeId;
            const node = newState.nodes.find(n => n.id === nodeId);
            node.occupant = { playerId: player.id, type: 'settlement' };
            player.settlements.push(nodeId);
            if (newState.phase === 'main') {
                deductResources(player, BUILDING_COSTS.settlement);
            }
            // Setup phase: give resources for second settlement
            if (newState.phase === 'setup' && newState.setupPhase.round === 1) {
                node.tiles.forEach(tileId => {
                    const tile = newState.tiles.find(t => t.id === tileId);
                    if (tile && tile.resource !== ResourceEnum.DESERT) {
                        player.resources[tile.resource]++;
                    }
                });
            }
            player.victoryPoints++;
            break;
        }
        case 'placeRoad': {
            const edgeId = action.payload.edgeId;
            const edge = newState.edges.find(e => e.id === edgeId);
            edge.roadOwner = player.id;
            player.roads.push(edgeId);
            if (newState.phase === 'main') {
                deductResources(player, BUILDING_COSTS.road);
            }
            break;
        }
        case 'upgradeToCity': {
            const nodeId = action.payload.nodeId;
            const node = newState.nodes.find(n => n.id === nodeId);
            node.occupant.type = 'city';
            player.cities.push(nodeId);
            const idx = player.settlements.indexOf(nodeId);
            if (idx !== -1) {
                player.settlements.splice(idx, 1);
            }
            deductResources(player, BUILDING_COSTS.city);
            player.victoryPoints++;
            break;
        }
        case 'endTurn': {
            newState.currentPlayerIdx = (newState.currentPlayerIdx + 1) % newState.players.length;
            // Handle setup phase progression
            if (newState.phase === 'setup') {
                newState.setupPhase.settlementsPlaced++;
                const totalPlayers = newState.players.length;
                if (newState.setupPhase.settlementsPlaced === totalPlayers) {
                    // First round complete, reverse order for second round
                    newState.setupPhase.round = 1;
                    newState.turnOrder.reverse();
                    newState.currentPlayerIdx = 0;
                }
                else if (newState.setupPhase.settlementsPlaced === totalPlayers * 2) {
                    // Setup complete
                    newState.phase = 'main';
                    newState.turnOrder.reverse(); // Restore original order
                    newState.currentPlayerIdx = 0;
                    delete newState.setupPhase;
                }
            }
            break;
        }
    }
    return newState;
}
export function collectResources(state, diceRoll) {
    const newState = JSON.parse(JSON.stringify(state));
    // Find tiles with this dice number
    const producingTiles = newState.tiles.filter(t => t.diceNumber === diceRoll && !t.robberPresent);
    producingTiles.forEach(tile => {
        // Find all nodes on this tile
        tile.nodes.forEach(nodeId => {
            const node = newState.nodes.find(n => n.id === nodeId);
            if (!node?.occupant)
                return;
            const player = newState.players.find(p => p.id === node.occupant.playerId);
            if (!player)
                return;
            // Check for blocking knights (enhanced mode)
            if (state.options.enhancedKnights) {
                const blockingKnight = newState.knights.find(k => k.nodeId === nodeId && k.ownerId !== player.id && k.active);
                if (blockingKnight)
                    return; // Blocked
            }
            // Grant resources
            const amount = node.occupant.type === 'city' ? 2 : 1;
            player.resources[tile.resource] += amount;
        });
    });
    newState.diceHistory.push(diceRoll);
    return newState;
}
export function getCurrentPlayer(state) {
    return state.players[state.currentPlayerIdx];
}
export function getLegalBuildLocations(state, playerId) {
    const player = state.players.find(p => p.id === playerId);
    if (!player)
        return { settlements: [], roads: [] };
    const settlements = [];
    const roads = [];
    // Find legal settlement locations
    state.nodes.forEach(node => {
        const validation = validatePlaceSettlement(state, player, node.id);
        if (validation.ok) {
            settlements.push(node.id);
        }
    });
    // Find legal road locations
    state.edges.forEach(edge => {
        const validation = validatePlaceRoad(state, player, edge.id);
        if (validation.ok) {
            roads.push(edge.id);
        }
    });
    return { settlements, roads };
}
//# sourceMappingURL=game.js.map