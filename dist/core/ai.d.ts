import type { GameState, Player, ResourceOffer, TradeProposal, ID } from '../models/types.js';
import { SeededRandom } from './utils.js';
/**
 * Decide whether AI should accept a trade proposal
 */
export declare function shouldAcceptTrade(state: GameState, proposal: TradeProposal, aiPlayerId: ID, rng?: SeededRandom): boolean;
/**
 * Generate a trade proposal from AI
 */
export declare function generateAITradeProposal(state: GameState, aiPlayerId: ID, rng?: SeededRandom): {
    targetId: ID | null;
    offering: ResourceOffer;
    requesting: ResourceOffer;
} | null;
/**
 * Generate a counter offer from AI
 */
export declare function generateAICounterOffer(state: GameState, originalProposal: TradeProposal, aiPlayerId: ID, rng?: SeededRandom): {
    offering: ResourceOffer;
    requesting: ResourceOffer;
} | null;
/**
 * Determine AI's preferred building action based on personality
 */
export declare function getAIBuildingPriority(player: Player, state: GameState): 'road' | 'settlement' | 'city' | 'developmentCard' | null;
//# sourceMappingURL=ai.d.ts.map