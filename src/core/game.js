// Core game logic and state management

import { Resource, BUILDING_COSTS } from '../models/types.js';
import { generateMap } from '../map/index.js';
import { generateId, SeededRandom } from './utils.js';
import { getAdjacentNodes, findEdge } from '../map/validator.js';
import {
  purchaseMilitaryKnight,
  placeWagon,
  repositionWagon,
  buildFleet,
  moveMilitaryKnight,
  moveFleet,
  loadKnightOntoFleet,
  unloadKnightFromFleet,
  updateKnightSupplyStatus,
  updateCaptureProgress,
  collectMaintenanceCosts,
  resetMovementFlags
} from './military.js';
import {
  validateCreateTradeProposal,
  createTradeProposal,
  validateAcceptTradeProposal,
  acceptTradeProposal,
  declineTradeProposal,
  cancelTradeProposal,
  validateExecuteTrade,
  executeTrade,
  createCounterOffer
} from './trade.js';

export function createGame(playerNames, options) {
  if (playerNames.length < 2 || playerNames.length > 6) {
    throw new Error('Game requires 2-6 players');
  }

  const gameId = generateId('game');

  // Create players
  const players = playerNames.map((name, idx) => ({
    id: generateId('player'),
    name,
    color: ['red', 'blue', 'orange', 'green', 'brown', 'purple'][idx],
    resources: {
      [Resource.ORE]: 0,
      [Resource.SHEEP]: 0,
      [Resource.WOOD]: 0,
      [Resource.BRICK]: 0,
      [Resource.WHEAT]: 0,
      [Resource.DESERT]: 0
    },
    roads: [],
    settlements: [],
    cities: [],
    knights: [],
    victoryPoints: 0,
    longestRoadLength: 0,
    armySize: 0,
    ...(options.militaryMode ? {
      militaryKnights: [],
      wagons: [],
      fleets: []
    } : {})
  }));

  // Generate map
  const mapData = generateMap(options);

  // Find robber starting position (desert)
  const desertTile = mapData.tiles.find(t => t.resource === Resource.DESERT);
  const robberTileId = desertTile?.id || mapData.tiles[0].id;

  // Initialize game state
  const gameState = {
    id: gameId,
    players,
    bank: {
      [Resource.ORE]: 19,
      [Resource.SHEEP]: 19,
      [Resource.WOOD]: 19,
      [Resource.BRICK]: 19,
      [Resource.WHEAT]: 19,
      [Resource.DESERT]: 0
    },
    tiles: mapData.tiles,
    nodes: mapData.nodes,
    edges: mapData.edges,
    knights: [],
    turnOrder: players.map(p => p.id),
    currentPlayerIdx: 0,
    currentTurnOrderIdx: 0, // Track position in turnOrder array for snake-like ordering
    phase: 'setup',
    setupPhase: {
      round: 0,
      totalRounds: Math.ceil(mapData.tiles.length / 15), // N/15 rounds, rounded up
      settlementsPlaced: 0,
      roadsPlaced: 0,
      playerSettlementThisTurn: false,
      playerRoadThisTurn: false,
      lastSettlementNodeId: null, // Track which settlement was just placed for road validation
      reverseOrder: false // Track if we should reverse turn order this round
    },
    diceHistory: [],
    robberTileId,
    longestRoadOwner: null,
    largestArmyOwner: null,
    seed: options.seed,
    options,
    ...(options.militaryMode ? {
      militaryKnights: [],
      wagons: [],
      fleets: [],
      captureProgress: []
    } : {}),
    tradeProposals: []
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

  // Military mode actions handled by military module
  if (state.options.militaryMode) {
    switch (action.type) {
      case 'purchaseMilitaryKnight':
      case 'placeWagon':
      case 'repositionWagon':
      case 'buildFleet':
      case 'moveMilitaryKnight':
      case 'moveFleet':
      case 'loadKnightOntoFleet':
      case 'unloadKnightFromFleet':
        return { ok: true }; // Validation done in military module
    }
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

    case 'createTradeProposal':
      return validateCreateTradeProposal(
        state,
        action.playerId,
        action.payload.targetId,
        action.payload.offering,
        action.payload.requesting
      );

    case 'acceptTradeProposal':
      return validateAcceptTradeProposal(state, action.payload.tradeId, action.playerId);

    case 'executeTrade':
      return validateExecuteTrade(state, action.payload.tradeId);

    case 'endTurn':
      return { ok: true };

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

  // In setup phase, only one settlement per turn
  if (state.phase === 'setup' && state.setupPhase.playerSettlementThisTurn) {
    return { ok: false, reason: 'Already placed a settlement this turn' };
  }

  // In main phase, must be connected to a road
  if (state.phase === 'main') {
    const hasConnectedRoad = state.edges.some(
      e => (e.nodeA === nodeId || e.nodeB === nodeId) && e.roadOwner === player.id
    );
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

  // In setup phase, only one road per turn
  if (state.phase === 'setup' && state.setupPhase.playerRoadThisTurn) {
    return { ok: false, reason: 'Already placed a road this turn' };
  }

  // In setup phase: road must connect to the settlement just placed
  if (state.phase === 'setup') {
    const lastSettlementId = state.setupPhase?.lastSettlementNodeId;
    if (lastSettlementId && edge.nodeA !== lastSettlementId && edge.nodeB !== lastSettlementId) {
      return { ok: false, reason: 'Road must connect to the settlement just placed' };
    }
  }

  // In main phase: must connect to existing network
  if (state.phase === 'main') {
    const nodeAHasConnection =
      state.nodes.find(n => n.id === edge.nodeA)?.occupant?.playerId === player.id ||
      state.edges.some(
        e => e.id !== edgeId &&
             (e.nodeA === edge.nodeA || e.nodeB === edge.nodeA) &&
             e.roadOwner === player.id
      );

    const nodeBHasConnection =
      state.nodes.find(n => n.id === edge.nodeB)?.occupant?.playerId === player.id ||
      state.edges.some(
        e => e.id !== edgeId &&
             (e.nodeA === edge.nodeB || e.nodeB === edge.nodeB) &&
             e.roadOwner === player.id
      );

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

      // Setup phase: track settlement placement and give resources for second settlement
      if (newState.phase === 'setup') {
        newState.setupPhase.playerSettlementThisTurn = true;
        newState.setupPhase.settlementsPlaced++;
        newState.setupPhase.lastSettlementNodeId = nodeId; // Track for road validation
        if (newState.setupPhase.round === 1) {
          node.tiles.forEach(tileId => {
            const tile = newState.tiles.find(t => t.id === tileId);
            if (tile && tile.resource !== Resource.DESERT) {
              player.resources[tile.resource]++;
            }
          });
        }
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
      } else if (newState.phase === 'setup') {
        newState.setupPhase.playerRoadThisTurn = true;
        newState.setupPhase.roadsPlaced++;
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
      // Military mode: collect maintenance and update capture progress
      if (newState.options.militaryMode && newState.phase === 'main') {
        const maintenanceResult = collectMaintenanceCosts(newState, player.id);
        if (!maintenanceResult.ok) {
          throw new Error(`Maintenance payment failed: ${maintenanceResult.reason}`);
        }
        updateCaptureProgress(newState);
        resetMovementFlags(newState);
      }

      // Handle setup phase progression
      if (newState.phase === 'setup') {
        const totalPlayers = newState.players.length;

        // Check if current player has completed their turn (placed 1 settlement and 1 road)
        if (newState.setupPhase.playerSettlementThisTurn && newState.setupPhase.playerRoadThisTurn) {
          // Reset flags for next player
          newState.setupPhase.playerSettlementThisTurn = false;
          newState.setupPhase.playerRoadThisTurn = false;
          newState.setupPhase.lastSettlementNodeId = null;

          // Move to next player
          newState.currentTurnOrderIdx++;

          // After all players have taken a turn, move to next round
          if (newState.currentTurnOrderIdx >= totalPlayers) {
            newState.currentTurnOrderIdx = 0;
            newState.setupPhase.round++;

            // Check if we've completed all setup rounds
            const totalRounds = newState.setupPhase.totalRounds;
            if (newState.setupPhase.round >= totalRounds) {
              newState.phase = 'main';
              delete newState.setupPhase;
            } else {
              // Reverse turn order for snake-like progression (every round after round 0)
              newState.turnOrder.reverse();
              // Adjust currentTurnOrderIdx after reversal: it should point to the first player
              newState.currentTurnOrderIdx = 0;
            }
          }

          // Update currentPlayerIdx based on turnOrder and currentTurnOrderIdx
          const playerIdAtTurnIdx = newState.turnOrder[newState.currentTurnOrderIdx];
          newState.currentPlayerIdx = newState.players.findIndex(p => p.id === playerIdAtTurnIdx);
        }
      } else {
        // Main phase: normal turn order
        newState.currentPlayerIdx = (newState.currentPlayerIdx + 1) % newState.players.length;
      }
      break;
    }

    // Military mode actions
    case 'purchaseMilitaryKnight': {
      const result = purchaseMilitaryKnight(newState, player.id, action.payload.tileId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    case 'placeWagon': {
      const result = placeWagon(newState, player.id, action.payload.edgeId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    case 'repositionWagon': {
      const result = repositionWagon(newState, player.id, action.payload.wagonId, action.payload.newEdgeId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    case 'buildFleet': {
      const result = buildFleet(newState, player.id, action.payload.tileId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    case 'moveMilitaryKnight': {
      const result = moveMilitaryKnight(newState, player.id, action.payload.knightId, action.payload.targetTileId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    case 'moveFleet': {
      const result = moveFleet(newState, player.id, action.payload.fleetId, action.payload.targetTileId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    case 'loadKnightOntoFleet': {
      const result = loadKnightOntoFleet(newState, player.id, action.payload.knightId, action.payload.fleetId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    case 'unloadKnightFromFleet': {
      const result = unloadKnightFromFleet(newState, player.id, action.payload.fleetId, action.payload.targetTileId);
      if (!result.ok) throw new Error(result.reason);
      break;
    }

    // Trade proposal actions
    case 'createTradeProposal': {
      return createTradeProposal(
        newState,
        action.playerId,
        action.payload.targetId,
        action.payload.offering,
        action.payload.requesting
      );
    }

    case 'acceptTradeProposal': {
      return acceptTradeProposal(newState, action.payload.tradeId, action.playerId);
    }

    case 'declineTradeProposal': {
      return declineTradeProposal(newState, action.payload.tradeId, action.playerId);
    }

    case 'cancelTradeProposal': {
      return cancelTradeProposal(newState, action.payload.tradeId, action.playerId);
    }

    case 'executeTrade': {
      return executeTrade(newState, action.payload.tradeId, action.payload.acceptorId);
    }

    case 'createCounterOffer': {
      return createCounterOffer(
        newState,
        action.payload.originalTradeId,
        action.playerId,
        action.payload.offering,
        action.payload.requesting
      );
    }
  }

  // Preserve non-serializable properties (Sets, etc.) that were lost in JSON stringify/parse
  if (state.aiPlayerIndices) {
    newState.aiPlayerIndices = state.aiPlayerIndices;
  }
  if (state.aiPersonalities) {
    newState.aiPersonalities = state.aiPersonalities;
  }

  return newState;
}

export function collectResources(state, diceRoll) {
  const newState = JSON.parse(JSON.stringify(state));

  // Find tiles with this dice number
  const producingTiles = newState.tiles.filter(
    t => t.diceNumber === diceRoll && !t.robberPresent
  );

  producingTiles.forEach(tile => {
    // Check if tile is blocked by a military knight
    let tileBlockedBy = null;
    if (newState.options.militaryMode && newState.militaryKnights) {
      const blockingKnight = newState.militaryKnights.find(
        k => k.tileId === tile.id && k.blockingProduction
      );
      if (blockingKnight) {
        tileBlockedBy = blockingKnight.ownerId;
      }
    }

    // Find all nodes on this tile
    tile.nodes.forEach(nodeId => {
      const node = newState.nodes.find(n => n.id === nodeId);
      if (!node?.occupant) return;

      const player = newState.players.find(p => p.id === node.occupant.playerId);
      if (!player) return;

      // In military mode, if tile is blocked and this player doesn't own the blocking knight, skip
      if (tileBlockedBy && tileBlockedBy !== player.id) {
        return;
      }

      // Check for blocking knights (enhanced mode)
      if (state.options.enhancedKnights) {
        const blockingKnight = newState.knights.find(
          k => k.nodeId === nodeId && k.ownerId !== player.id && k.active
        );
        if (blockingKnight) return; // Blocked
      }

      // Grant resources
      const amount = node.occupant.type === 'city' ? 2 : 1;
      player.resources[tile.resource] += amount;
    });
  });

  newState.diceHistory.push(diceRoll);

  // Preserve non-serializable properties (Sets, etc.) that were lost in JSON stringify/parse
  if (state.aiPlayerIndices) {
    newState.aiPlayerIndices = state.aiPlayerIndices;
  }
  if (state.aiPersonalities) {
    newState.aiPersonalities = state.aiPersonalities;
  }

  return newState;
}

export function getCurrentPlayer(state) {
  return state.players[state.currentPlayerIdx];
}

export function getLegalBuildLocations(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { settlements: [], roads: [] };

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
