// Military game mode implementation
import {
  Resource,
  BUILDING_COSTS,
  MAINTENANCE_COSTS
} from '../models/types.js';
import { generateId } from './utils.js';

function hasResources(player, cost) {
  for (const [resource, amount] of Object.entries(cost)) {
    if (amount && player.resources[resource] < amount) {
      return false;
    }
  }
  return true;
}

function deductResources(player, cost) {
  for (const [resource, amount] of Object.entries(cost)) {
    if (amount) {
      player.resources[resource] -= amount;
    }
  }
}

function isWaterTile(tile) {
  return tile.resource === Resource.DESERT && tile.diceNumber === null;
}

function getAdjacentTiles(tileId, tiles, edges) {
  const tile = tiles.find(t => t.id === tileId);
  if (!tile) return [];

  const adjacentTileIds = new Set();

  for (const edgeId of tile.edges) {
    const edge = edges.find(e => e.id === edgeId);
    if (!edge) continue;

    if (edge.tileLeft && edge.tileLeft !== tileId) {
      adjacentTileIds.add(edge.tileLeft);
    }
    if (edge.tileRight && edge.tileRight !== tileId) {
      adjacentTileIds.add(edge.tileRight);
    }
  }

  return Array.from(adjacentTileIds);
}

function isKnightSupplied(knightTileId, ownerId, state) {
  const { nodes, edges, wagons = [], tiles } = state;
  const player = state.players.find(p => p.id === ownerId);
  if (!player) return false;

  const knightTile = tiles.find(t => t.id === knightTileId);
  if (!knightTile) return false;

  const knightNodes = knightTile.nodes;

  const baseNodes = new Set([...player.settlements, ...player.cities]);

  for (const baseNodeId of baseNodes) {
    const visited = new Set();
    const queue = [baseNodeId];
    visited.add(baseNodeId);

    while (queue.length > 0) {
      const currentNode = queue.shift();

      if (knightNodes.includes(currentNode)) {
        return true;
      }

      const playerWagons = wagons.filter(w => w.ownerId === ownerId);

      for (const wagon of playerWagons) {
        const edge = edges.find(e => e.id === wagon.edgeId);
        if (!edge) continue;

        let nextNode = null;
        if (edge.nodeA === currentNode && !visited.has(edge.nodeB)) {
          nextNode = edge.nodeB;
        } else if (edge.nodeB === currentNode && !visited.has(edge.nodeA)) {
          nextNode = edge.nodeA;
        }

        if (nextNode) {
          visited.add(nextNode);
          queue.push(nextNode);
        }
      }

      const playerRoadEdges = edges.filter(e => e.roadOwner === ownerId);
      for (const edge of playerRoadEdges) {
        let nextNode = null;
        if (edge.nodeA === currentNode && !visited.has(edge.nodeB)) {
          nextNode = edge.nodeB;
        } else if (edge.nodeB === currentNode && !visited.has(edge.nodeA)) {
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

export function updateKnightSupplyStatus(state) {
  if (!state.militaryKnights) return;

  for (const knight of state.militaryKnights) {
    if (knight.carriedByFleetId) {
      knight.supplied = false;
      continue;
    }

    knight.supplied = isKnightSupplied(knight.tileId, knight.ownerId, state);
    knight.blockingProduction = knight.supplied;
  }
}

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

  if (isWaterTile(tile)) {
    return { ok: false, reason: 'Cannot deploy knight on water tile' };
  }

  const cost = BUILDING_COSTS.militaryKnight;
  if (!hasResources(player, cost)) {
    return { ok: false, reason: 'Insufficient resources' };
  }

  if (state.militaryKnights?.some(k => k.tileId === tileId)) {
    return { ok: false, reason: 'Tile already has a knight' };
  }

  const knight = {
    id: generateId(),
    ownerId: playerId,
    tileId,
    supplied: false,
    hasMoved: false,
    blockingProduction: false
  };

  if (!state.militaryKnights) state.militaryKnights = [];
  if (!player.militaryKnights) player.militaryKnights = [];

  state.militaryKnights.push(knight);
  player.militaryKnights.push(knight.id);

  deductResources(player, cost);
  updateKnightSupplyStatus(state);

  return { ok: true };
}

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

  const cost = BUILDING_COSTS.wagon;
  if (!hasResources(player, cost)) {
    return { ok: false, reason: 'Insufficient resources' };
  }

  if (state.wagons?.some(w => w.edgeId === edgeId)) {
    return { ok: false, reason: 'Edge already has a wagon' };
  }
  if (edge.roadOwner !== null && edge.roadOwner !== undefined) {
    return { ok: false, reason: 'Edge already has a road' };
  }

  const wagon = {
    id: generateId(),
    ownerId: playerId,
    edgeId,
    hasBeenRepositioned: false
  };

  if (!state.wagons) state.wagons = [];
  if (!player.wagons) player.wagons = [];

  state.wagons.push(wagon);
  player.wagons.push(wagon.id);

  deductResources(player, cost);
  updateKnightSupplyStatus(state);

  return { ok: true };
}

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

  if (state.wagons?.some(w => w.edgeId === newEdgeId)) {
    return { ok: false, reason: 'Edge already has a wagon' };
  }
  if (newEdge.roadOwner !== null && newEdge.roadOwner !== undefined) {
    return { ok: false, reason: 'Edge already has a road' };
  }

  wagon.edgeId = newEdgeId;
  wagon.hasBeenRepositioned = true;

  updateKnightSupplyStatus(state);

  return { ok: true };
}

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

  if (!isWaterTile(tile)) {
    return { ok: false, reason: 'Can only build fleet on water tile' };
  }

  const cost = BUILDING_COSTS.fleet;
  if (!hasResources(player, cost)) {
    return { ok: false, reason: 'Insufficient resources' };
  }

  if (state.fleets?.some(f => f.tileId === tileId)) {
    return { ok: false, reason: 'Tile already has a fleet' };
  }

  const fleet = {
    id: generateId(),
    ownerId: playerId,
    tileId,
    hasMoved: false
  };

  if (!state.fleets) state.fleets = [];
  if (!player.fleets) player.fleets = [];

  state.fleets.push(fleet);
  player.fleets.push(fleet.id);

  deductResources(player, cost);

  return { ok: true };
}

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

  if (isWaterTile(targetTile)) {
    return { ok: false, reason: 'Cannot move knight to water tile' };
  }

  const adjacentTiles = getAdjacentTiles(knight.tileId, state.tiles, state.edges);
  if (!adjacentTiles.includes(targetTileId)) {
    return { ok: false, reason: 'Target tile is not adjacent' };
  }

  if (state.militaryKnights?.some(k => k.tileId === targetTileId)) {
    return { ok: false, reason: 'Target tile already has a knight' };
  }

  knight.tileId = targetTileId;
  knight.hasMoved = true;

  updateKnightSupplyStatus(state);

  return { ok: true };
}

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

  if (!isWaterTile(targetTile)) {
    return { ok: false, reason: 'Fleet can only move to water tiles' };
  }

  const adjacentTiles = getAdjacentTiles(fleet.tileId, state.tiles, state.edges);
  if (!adjacentTiles.includes(targetTileId)) {
    return { ok: false, reason: 'Target tile is not adjacent' };
  }

  if (state.fleets?.some(f => f.tileId === targetTileId)) {
    return { ok: false, reason: 'Target tile already has a fleet' };
  }

  fleet.tileId = targetTileId;
  fleet.hasMoved = true;

  return { ok: true };
}

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

  const adjacentTiles = getAdjacentTiles(fleet.tileId, state.tiles, state.edges);
  if (!adjacentTiles.includes(knight.tileId)) {
    return { ok: false, reason: 'Knight must be adjacent to fleet' };
  }

  fleet.carryingKnightId = knight.id;
  knight.carriedByFleetId = fleet.id;
  knight.supplied = false;
  knight.blockingProduction = false;

  return { ok: true };
}

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

  if (isWaterTile(targetTile)) {
    return { ok: false, reason: 'Cannot unload knight to water tile' };
  }

  const adjacentTiles = getAdjacentTiles(fleet.tileId, state.tiles, state.edges);
  if (!adjacentTiles.includes(targetTileId)) {
    return { ok: false, reason: 'Target tile must be adjacent to fleet' };
  }

  if (state.militaryKnights?.some(k => k.tileId === targetTileId)) {
    return { ok: false, reason: 'Target tile already has a knight' };
  }

  knight.tileId = targetTileId;
  knight.carriedByFleetId = undefined;
  fleet.carryingKnightId = undefined;

  updateKnightSupplyStatus(state);

  return { ok: true };
}

function isSurrounded(nodeId, attackerId, state) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return false;

  const { tiles, militaryKnights = [] } = state;

  const adjacentLandTiles = node.tiles.filter(tileId => {
    const tile = tiles.find(t => t.id === tileId);
    return tile && !isWaterTile(tile);
  });

  if (adjacentLandTiles.length === 0) return false;

  for (const tileId of adjacentLandTiles) {
    const hasAttackerKnight = militaryKnights.some(
      k => k.tileId === tileId && k.ownerId === attackerId && k.supplied
    );

    if (!hasAttackerKnight) {
      return false;
    }
  }

  return true;
}

export function updateCaptureProgress(state) {
  if (!state.options.militaryMode) return;
  if (!state.captureProgress) state.captureProgress = [];

  const { nodes, players } = state;

  for (const node of nodes) {
    if (!node.occupant) continue;

    const defenderId = node.occupant.playerId;
    const requiredTurns = node.occupant.type === 'settlement' ? 3 : 6;

    for (const player of players) {
      if (player.id === defenderId) continue;

      const surrounded = isSurrounded(node.id, player.id, state);

      const existingProgress = state.captureProgress.find(
        cp => cp.nodeId === node.id && cp.attackerId === player.id
      );

      if (surrounded) {
        if (existingProgress) {
          existingProgress.turnsHeld++;

          if (existingProgress.turnsHeld >= requiredTurns) {
            captureSettlement(state, node.id, player.id);
            state.captureProgress = state.captureProgress.filter(
              cp => !(cp.nodeId === node.id && cp.attackerId === player.id)
            );
          }
        } else {
          state.captureProgress.push({
            nodeId: node.id,
            attackerId: player.id,
            turnsHeld: 1,
            requiredTurns
          });
        }
      } else if (existingProgress) {
        state.captureProgress = state.captureProgress.filter(
          cp => !(cp.nodeId === node.id && cp.attackerId === player.id)
        );
      }
    }
  }
}

function captureSettlement(state, nodeId, attackerId) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node || !node.occupant) return;

  const defender = state.players.find(p => p.id === node.occupant.playerId);
  const attacker = state.players.find(p => p.id === attackerId);
  if (!defender || !attacker) return;

  const isCity = node.occupant.type === 'city';

  if (isCity) {
    defender.cities = defender.cities.filter(id => id !== nodeId);
    defender.victoryPoints -= 2;
  } else {
    defender.settlements = defender.settlements.filter(id => id !== nodeId);
    defender.victoryPoints -= 1;
  }

  if (isCity) {
    attacker.cities.push(nodeId);
    attacker.victoryPoints += 2;
  } else {
    attacker.settlements.push(nodeId);
    attacker.victoryPoints += 1;
  }

  node.occupant = {
    playerId: attackerId,
    type: node.occupant.type
  };
}

export function collectMaintenanceCosts(state, playerId) {
  if (!state.options.militaryMode) {
    return { ok: true };
  }

  const player = state.players.find(p => p.id === playerId);
  if (!player) {
    return { ok: false, reason: 'Player not found' };
  }

  const totalCost = {
    [Resource.ORE]: 0,
    [Resource.SHEEP]: 0,
    [Resource.WOOD]: 0,
    [Resource.BRICK]: 0,
    [Resource.WHEAT]: 0,
    [Resource.DESERT]: 0
  };

  const knightCount = player.militaryKnights?.length || 0;
  for (const [resource, amount] of Object.entries(MAINTENANCE_COSTS.militaryKnight)) {
    totalCost[resource] += amount * knightCount;
  }

  const wagonCount = player.wagons?.length || 0;
  for (const [resource, amount] of Object.entries(MAINTENANCE_COSTS.wagon)) {
    totalCost[resource] += amount * wagonCount;
  }

  const fleetCount = player.fleets?.length || 0;
  for (const [resource, amount] of Object.entries(MAINTENANCE_COSTS.fleet)) {
    totalCost[resource] += amount * fleetCount;
  }

  if (!hasResources(player, totalCost)) {
    return { ok: false, reason: 'Cannot afford maintenance costs' };
  }

  deductResources(player, totalCost);

  return { ok: true };
}

export function resetMovementFlags(state) {
  if (!state.options.militaryMode) return;

  if (state.militaryKnights) {
    for (const knight of state.militaryKnights) {
      knight.hasMoved = false;
    }
  }

  if (state.fleets) {
    for (const fleet of state.fleets) {
      fleet.hasMoved = false;
    }
  }

  if (state.wagons) {
    for (const wagon of state.wagons) {
      wagon.hasBeenRepositioned = false;
    }
  }
}
