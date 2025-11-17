import type { GameState, GameOptions, Player, Action, ActionResult, ID } from '../models/types.js';
import { SeededRandom } from './utils.js';
export declare function createGame(playerNames: string[], options: GameOptions): GameState;
export declare function rollDice(rng?: SeededRandom): number;
export declare function validateAction(state: GameState, action: Action): ActionResult;
export declare function applyAction(state: GameState, action: Action): GameState;
export declare function collectResources(state: GameState, diceRoll: number): GameState;
export declare function getCurrentPlayer(state: GameState): Player;
export declare function getLegalBuildLocations(state: GameState, playerId: ID): {
    settlements: string[];
    roads: string[];
};
//# sourceMappingURL=game.d.ts.map