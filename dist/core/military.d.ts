import { GameState, ID, ActionResult } from '../models/types.js';
export declare function updateKnightSupplyStatus(state: GameState): void;
export declare function purchaseMilitaryKnight(state: GameState, playerId: ID, tileId: ID): ActionResult;
export declare function placeWagon(state: GameState, playerId: ID, edgeId: ID): ActionResult;
export declare function repositionWagon(state: GameState, playerId: ID, wagonId: ID, newEdgeId: ID): ActionResult;
export declare function buildFleet(state: GameState, playerId: ID, tileId: ID): ActionResult;
export declare function moveMilitaryKnight(state: GameState, playerId: ID, knightId: ID, targetTileId: ID): ActionResult;
export declare function moveFleet(state: GameState, playerId: ID, fleetId: ID, targetTileId: ID): ActionResult;
export declare function loadKnightOntoFleet(state: GameState, playerId: ID, knightId: ID, fleetId: ID): ActionResult;
export declare function unloadKnightFromFleet(state: GameState, playerId: ID, fleetId: ID, targetTileId: ID): ActionResult;
export declare function updateCaptureProgress(state: GameState): void;
export declare function collectMaintenanceCosts(state: GameState, playerId: ID): ActionResult;
export declare function resetMovementFlags(state: GameState): void;
//# sourceMappingURL=military.d.ts.map