import type { GameState, Player, TradeOffer, TradeProposal } from '../models/types.js';
import { SeededRandom } from './utils.js';
export declare function evaluateTradeOffer(player: Player, giving: TradeOffer, receiving: TradeOffer): number;
export declare function aiShouldAcceptTrade(player: Player, proposal: TradeProposal): boolean;
export declare function aiGenerateTradeProposal(state: GameState, aiPlayer: Player, rng: SeededRandom): TradeProposal | null;
export declare function aiMakeCounterOffer(state: GameState, aiPlayer: Player, originalProposal: TradeProposal, rng: SeededRandom): TradeProposal | null;
export declare function aiDecideBuildAction(player: Player, state: GameState): 'road' | 'settlement' | 'city' | null;
//# sourceMappingURL=ai.d.ts.map