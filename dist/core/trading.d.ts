import type { GameState, TradeProposal, TradeOffer, ID, ActionResult } from '../models/types.js';
export declare function createTradeProposal(state: GameState, proposerId: ID, proposerOffer: TradeOffer, recipientId: ID, recipientOffer: TradeOffer): {
    proposal: TradeProposal;
    valid: boolean;
    reason?: string;
};
export declare function agreeToTrade(state: GameState, proposalId: ID, playerId: ID): ActionResult;
export declare function declineTrade(state: GameState, proposalId: ID, playerId: ID): ActionResult;
export declare function executeTrade(state: GameState, proposalId: ID): {
    success: boolean;
    reason?: string;
    newState?: GameState;
};
export declare function createCounterOffer(state: GameState, originalProposalId: ID, countererId: ID, counterProposerOffer: TradeOffer, counterRecipientOffer: TradeOffer): {
    proposal?: TradeProposal;
    valid: boolean;
    reason?: string;
};
export declare function cleanupOldProposals(state: GameState, maxAge?: number): void;
//# sourceMappingURL=trading.d.ts.map