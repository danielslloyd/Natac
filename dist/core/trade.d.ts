import type { GameState, ResourceOffer, ID, ActionResult } from '../models/types.js';
/**
 * Validate a trade proposal creation
 */
export declare function validateCreateTradeProposal(state: GameState, proposerId: ID, targetId: ID | null, offering: ResourceOffer, requesting: ResourceOffer): ActionResult;
/**
 * Create a trade proposal
 */
export declare function createTradeProposal(state: GameState, proposerId: ID, targetId: ID | null, offering: ResourceOffer, requesting: ResourceOffer): GameState;
/**
 * Validate accepting a trade proposal
 */
export declare function validateAcceptTradeProposal(state: GameState, tradeId: ID, acceptorId: ID): ActionResult;
/**
 * Accept a trade proposal
 */
export declare function acceptTradeProposal(state: GameState, tradeId: ID, acceptorId: ID): GameState;
/**
 * Decline a trade proposal
 */
export declare function declineTradeProposal(state: GameState, tradeId: ID, declinerId: ID): GameState;
/**
 * Cancel a trade proposal (only proposer can cancel)
 */
export declare function cancelTradeProposal(state: GameState, tradeId: ID, playerId: ID): GameState;
/**
 * Validate executing a trade
 * Trade can only execute if one participant is the active player
 */
export declare function validateExecuteTrade(state: GameState, tradeId: ID): ActionResult;
/**
 * Execute a trade between two players
 */
export declare function executeTrade(state: GameState, tradeId: ID, acceptorId?: ID): GameState;
/**
 * Create a counter offer
 */
export declare function createCounterOffer(state: GameState, originalTradeId: ID, countererId: ID, offering: ResourceOffer, requesting: ResourceOffer): GameState;
//# sourceMappingURL=trade.d.ts.map