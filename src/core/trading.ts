// Trading system logic

import type {
  GameState,
  Player,
  TradeProposal,
  TradeOffer,
  ID,
  Resource,
  ActionResult
} from '../models/types.js';
import { Resource as ResourceEnum } from '../models/types.js';
import { generateId } from './utils.js';

// Create a new trade proposal
export function createTradeProposal(
  state: GameState,
  proposerId: ID,
  proposerOffer: TradeOffer,
  recipientId: ID,
  recipientOffer: TradeOffer
): { proposal: TradeProposal; valid: boolean; reason?: string } {
  const proposer = state.players.find(p => p.id === proposerId);
  const recipient = state.players.find(p => p.id === recipientId);

  if (!proposer || !recipient) {
    return {
      proposal: null as any,
      valid: false,
      reason: 'Invalid player IDs'
    };
  }

  // Validate trade offers
  const validation = validateTradeOffer(proposerOffer, recipientOffer, state.options.allowFuturesTrades);
  if (!validation.valid) {
    return {
      proposal: null as any,
      valid: false,
      reason: validation.reason
    };
  }

  // Check if proposer has resources for current offer
  if (!hasResourcesForOffer(proposer, proposerOffer)) {
    return {
      proposal: null as any,
      valid: false,
      reason: 'Proposer does not have enough resources'
    };
  }

  const proposal: TradeProposal = {
    id: generateId('trade'),
    proposerId,
    proposerOffer,
    recipientId,
    recipientOffer,
    status: 'pending',
    agreedBy: [proposerId], // Proposer automatically agrees
    declinedBy: [],
    createdAt: Date.now(),
    counterOffers: []
  };

  return { proposal, valid: true };
}

// Validate a trade offer
function validateTradeOffer(
  offer1: TradeOffer,
  offer2: TradeOffer,
  allowFutures?: boolean
): { valid: boolean; reason?: string } {
  // Check that at least one side offers something
  const total1 = getTotalResourceCount(offer1);
  const total2 = getTotalResourceCount(offer2);

  if (total1 === 0 || total2 === 0) {
    return {
      valid: false,
      reason: 'Both sides must offer at least one resource'
    };
  }

  // Check all values are positive integers
  const allOffers = [
    ...Object.values(offer1.current),
    ...Object.values(offer1.future),
    ...Object.values(offer2.current),
    ...Object.values(offer2.future)
  ];

  for (const val of allOffers) {
    if (val !== undefined && (val < 0 || !Number.isInteger(val))) {
      return {
        valid: false,
        reason: 'All resource counts must be positive integers'
      };
    }
  }

  // Check futures are allowed if used
  if (!allowFutures) {
    const hasFutures =
      Object.keys(offer1.future).length > 0 ||
      Object.keys(offer2.future).length > 0;

    if (hasFutures) {
      return {
        valid: false,
        reason: 'Futures trading is not enabled'
      };
    }
  }

  return { valid: true };
}

// Get total resource count in an offer
function getTotalResourceCount(offer: TradeOffer): number {
  const currentTotal = Object.values(offer.current).reduce((sum, val) => sum + (val || 0), 0);
  const futureTotal = Object.values(offer.future).reduce((sum, val) => sum + (val || 0), 0);
  return currentTotal + futureTotal;
}

// Check if player has resources for an offer
function hasResourcesForOffer(player: Player, offer: TradeOffer): boolean {
  // Check current resources
  for (const [resource, amount] of Object.entries(offer.current)) {
    if (amount && player.resources[resource as Resource] < amount) {
      return false;
    }
  }

  // Future resources don't need to be checked (they're promised)
  return true;
}

// Agree to a trade proposal
export function agreeToTrade(
  state: GameState,
  proposalId: ID,
  playerId: ID
): ActionResult {
  const proposal = state.tradeProposals.find(p => p.id === proposalId);
  if (!proposal) {
    return { ok: false, reason: 'Trade proposal not found' };
  }

  if (proposal.status !== 'pending') {
    return { ok: false, reason: 'Trade proposal is no longer pending' };
  }

  // Check if player is involved in the trade
  if (playerId !== proposal.proposerId && playerId !== proposal.recipientId) {
    return { ok: false, reason: 'Player is not involved in this trade' };
  }

  // Add to agreed list if not already there
  if (!proposal.agreedBy.includes(playerId)) {
    proposal.agreedBy.push(playerId);
  }

  // Remove from declined list if there
  const declineIdx = proposal.declinedBy.indexOf(playerId);
  if (declineIdx !== -1) {
    proposal.declinedBy.splice(declineIdx, 1);
  }

  return { ok: true };
}

// Decline a trade proposal
export function declineTrade(
  state: GameState,
  proposalId: ID,
  playerId: ID
): ActionResult {
  const proposal = state.tradeProposals.find(p => p.id === proposalId);
  if (!proposal) {
    return { ok: false, reason: 'Trade proposal not found' };
  }

  if (proposal.status !== 'pending') {
    return { ok: false, reason: 'Trade proposal is no longer pending' };
  }

  // Add to declined list
  if (!proposal.declinedBy.includes(playerId)) {
    proposal.declinedBy.push(playerId);
  }

  // Remove from agreed list
  const agreeIdx = proposal.agreedBy.indexOf(playerId);
  if (agreeIdx !== -1) {
    proposal.agreedBy.splice(agreeIdx, 1);
  }

  // Check if all players have declined
  const allPlayers = [proposal.proposerId, proposal.recipientId];
  const allDeclined = allPlayers.every(pid => proposal.declinedBy.includes(pid));

  if (allDeclined) {
    // Remove proposal
    const idx = state.tradeProposals.indexOf(proposal);
    if (idx !== -1) {
      state.tradeProposals.splice(idx, 1);
    }
  }

  return { ok: true };
}

// Execute a trade (only if one player is active)
export function executeTrade(
  state: GameState,
  proposalId: ID
): { success: boolean; reason?: string; newState?: GameState } {
  const proposal = state.tradeProposals.find(p => p.id === proposalId);
  if (!proposal) {
    return { success: false, reason: 'Trade proposal not found' };
  }

  // Check if both players have agreed
  if (!proposal.agreedBy.includes(proposal.proposerId) ||
      !proposal.agreedBy.includes(proposal.recipientId)) {
    return { success: false, reason: 'Both players must agree before executing' };
  }

  // Check if at least one player is active (it's their turn)
  const currentPlayerId = state.players[state.currentPlayerIdx].id;
  if (currentPlayerId !== proposal.proposerId && currentPlayerId !== proposal.recipientId) {
    return {
      success: false,
      reason: 'Trade can only be executed on one of the involved players\' turn'
    };
  }

  const proposer = state.players.find(p => p.id === proposal.proposerId)!;
  const recipient = state.players.find(p => p.id === proposal.recipientId)!;

  // Verify both players still have the resources
  if (!hasResourcesForOffer(proposer, proposal.proposerOffer)) {
    return { success: false, reason: 'Proposer no longer has required resources' };
  }

  if (!hasResourcesForOffer(recipient, proposal.recipientOffer)) {
    return { success: false, reason: 'Recipient no longer has required resources' };
  }

  // Clone state for immutability
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  const newProposer = newState.players.find(p => p.id === proposal.proposerId)!;
  const newRecipient = newState.players.find(p => p.id === proposal.recipientId)!;

  // Execute trade - transfer current resources
  for (const [resource, amount] of Object.entries(proposal.proposerOffer.current)) {
    if (amount) {
      newProposer.resources[resource as Resource] -= amount;
      newRecipient.resources[resource as Resource] += amount;
    }
  }

  for (const [resource, amount] of Object.entries(proposal.recipientOffer.current)) {
    if (amount) {
      newRecipient.resources[resource as Resource] -= amount;
      newProposer.resources[resource as Resource] += amount;
    }
  }

  // Handle future resources - add to committed futures
  for (const [resource, amount] of Object.entries(proposal.proposerOffer.future)) {
    if (amount) {
      newProposer.futureResources[resource as Resource] =
        (newProposer.futureResources[resource as Resource] || 0) + amount;
    }
  }

  for (const [resource, amount] of Object.entries(proposal.recipientOffer.future)) {
    if (amount) {
      newRecipient.futureResources[resource as Resource] =
        (newRecipient.futureResources[resource as Resource] || 0) + amount;
    }
  }

  // Remove executed proposal
  const idx = newState.tradeProposals.findIndex(p => p.id === proposalId);
  if (idx !== -1) {
    newState.tradeProposals.splice(idx, 1);
  }

  return { success: true, newState };
}

// Create a counter-offer
export function createCounterOffer(
  state: GameState,
  originalProposalId: ID,
  countererId: ID,
  counterProposerOffer: TradeOffer,
  counterRecipientOffer: TradeOffer
): { proposal?: TradeProposal; valid: boolean; reason?: string } {
  const original = state.tradeProposals.find(p => p.id === originalProposalId);
  if (!original) {
    return { valid: false, reason: 'Original proposal not found' };
  }

  // Determine who is proposing the counter (swap if needed)
  let proposerId: ID;
  let recipientId: ID;
  let proposerOffer: TradeOffer;
  let recipientOffer: TradeOffer;

  if (countererId === original.proposerId) {
    proposerId = original.proposerId;
    recipientId = original.recipientId;
    proposerOffer = counterProposerOffer;
    recipientOffer = counterRecipientOffer;
  } else if (countererId === original.recipientId) {
    proposerId = original.recipientId;
    recipientId = original.proposerId;
    proposerOffer = counterRecipientOffer; // Swap
    recipientOffer = counterProposerOffer; // Swap
  } else {
    return { valid: false, reason: 'Counterer is not involved in the original trade' };
  }

  const result = createTradeProposal(
    state,
    proposerId,
    proposerOffer,
    recipientId,
    recipientOffer
  );

  if (result.valid && result.proposal) {
    // Link as counter-offer
    if (!original.counterOffers) {
      original.counterOffers = [];
    }
    original.counterOffers.push(result.proposal);
  }

  return result;
}

// Clean up old trade proposals (e.g., after a turn ends)
export function cleanupOldProposals(state: GameState, maxAge: number = 300000): void {
  const now = Date.now();
  state.tradeProposals = state.tradeProposals.filter(
    p => now - p.createdAt < maxAge
  );
}
