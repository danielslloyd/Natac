import type { GameState, ID } from '../models/types.js';
export declare function handleRobberActivation(state: GameState): GameState;
export declare function moveRobber(state: GameState, playerId: ID, targetTileId: ID, stealFromPlayerId?: ID): GameState;
export declare function playKnight(state: GameState, playerId: ID, nodeId: ID, newRobberTileId: ID, stealFromPlayerId?: ID): GameState;
export declare function updateLargestArmy(state: GameState): void;
export declare function getPlayersOnTile(state: GameState, tileId: ID): ID[];
//# sourceMappingURL=robber.d.ts.map