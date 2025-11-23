// Trade proposal logic and validation
import { Resource as ResourceEnum } from '../models/types.js';
import { generateId } from './utils.js';
/**
 * Helper to check if resource offer is valid (positive integers, at least one resource)
 */
function isValidResourceOffer(offer, allowFutures) {
    const current = offer.current;
    const futures = offer.futures || {};
    let totalCurrent = 0;
    let totalFutures = 0;
    // Check current resources
    for (const resource of Object.values(ResourceEnum)) {
        if (resource === ResourceEnum.DESERT)
            continue; // Skip desert
        const amount = current[resource] || 0;
        if (amount < 0 || !Number.isInteger(amount)) {
            return false;
        }
        totalCurrent += amount;
    }
    // Check futures if enabled
    if (allowFutures && futures) {
        for (const resource of Object.values(ResourceEnum)) {
            if (resource === ResourceEnum.DESERT)
                continue;
            const amount = futures[resource] || 0;
            if (amount < 0 || !Number.isInteger(amount)) {
                return false;
            }
            totalFutures += amount;
        }
    }
    else if (futures && Object.values(futures).some((v) => v > 0)) {
        // Futures not allowed but futures specified
        return false;
    }
    // At least one resource must be offered
    return totalCurrent + totalFutures > 0;
}
/**
 * Helper to check if player has the resources in an offer
 */
function hasOfferResources(player, offer) {
    const current = offer.current;
    for (const resource of Object.values(ResourceEnum)) {
        if (resource === ResourceEnum.DESERT)
            continue;
        const amount = current[resource] || 0;
        if (player.resources[resource] < amount) {
            return false;
        }
    }
    // Note: We don't validate futures here - player promises to have them next turn
    return true;
}
/**
 * Helper to create empty resource record
 */
function emptyResources() {
    return {
        [ResourceEnum.ORE]: 0,
        [ResourceEnum.SHEEP]: 0,
        [ResourceEnum.WOOD]: 0,
        [ResourceEnum.BRICK]: 0,
        [ResourceEnum.WHEAT]: 0,
        [ResourceEnum.DESERT]: 0
    };
}
/**
 * Validate a trade proposal creation
 */
export function validateCreateTradeProposal(state, proposerId, targetId, offering, requesting) {
    const proposer = state.players.find(p => p.id === proposerId);
    if (!proposer) {
        return { ok: false, reason: 'Proposer not found' };
    }
    // If target specified, must exist
    if (targetId) {
        const target = state.players.find(p => p.id === targetId);
        if (!target) {
            return { ok: false, reason: 'Target player not found' };
        }
        if (targetId === proposerId) {
            return { ok: false, reason: 'Cannot trade with yourself' };
        }
    }
    // Validate offers
    const futuresEnabled = state.options.futuresTrading || false;
    if (!isValidResourceOffer(offering, futuresEnabled)) {
        return { ok: false, reason: 'Invalid offering' };
    }
    if (!isValidResourceOffer(requesting, futuresEnabled)) {
        return { ok: false, reason: 'Invalid request' };
    }
    // Check proposer has current resources they're offering
    if (!hasOfferResources(proposer, offering)) {
        return { ok: false, reason: 'Insufficient resources to offer' };
    }
    return { ok: true };
}
/**
 * Create a trade proposal
 */
export function createTradeProposal(state, proposerId, targetId, offering, requesting) {
    const validation = validateCreateTradeProposal(state, proposerId, targetId, offering, requesting);
    if (!validation.ok) {
        throw new Error(`Invalid trade proposal: ${validation.reason}`);
    }
    const newState = JSON.parse(JSON.stringify(state));
    const proposal = {
        id: generateId('trade'),
        proposerId,
        targetId,
        offering,
        requesting,
        status: 'pending',
        acceptedBy: [],
        counterOffers: [],
        createdTurn: newState.diceHistory.length, // Use turn count as proxy
        currentDeclines: 0
    };
    newState.tradeProposals.push(proposal);
    return newState;
}
/**
 * Validate accepting a trade proposal
 */
export function validateAcceptTradeProposal(state, tradeId, acceptorId) {
    const proposal = state.tradeProposals.find(t => t.id === tradeId);
    if (!proposal) {
        return { ok: false, reason: 'Trade proposal not found' };
    }
    if (proposal.status !== 'pending') {
        return { ok: false, reason: 'Trade proposal no longer pending' };
    }
    const acceptor = state.players.find(p => p.id === acceptorId);
    if (!acceptor) {
        return { ok: false, reason: 'Acceptor not found' };
    }
    // Cannot accept your own proposal
    if (acceptorId === proposal.proposerId) {
        return { ok: false, reason: 'Cannot accept your own proposal' };
    }
    // If proposal has specific target, only that player can accept
    if (proposal.targetId && proposal.targetId !== acceptorId) {
        return { ok: false, reason: 'This trade is for another player' };
    }
    // Check if already accepted
    if (proposal.acceptedBy.includes(acceptorId)) {
        return { ok: false, reason: 'Already accepted this proposal' };
    }
    // Check acceptor has resources being requested
    if (!hasOfferResources(acceptor, proposal.requesting)) {
        return { ok: false, reason: 'Insufficient resources to accept' };
    }
    return { ok: true };
}
/**
 * Accept a trade proposal
 */
export function acceptTradeProposal(state, tradeId, acceptorId) {
    const validation = validateAcceptTradeProposal(state, tradeId, acceptorId);
    if (!validation.ok) {
        throw new Error(`Cannot accept trade: ${validation.reason}`);
    }
    const newState = JSON.parse(JSON.stringify(state));
    const proposal = newState.tradeProposals.find(t => t.id === tradeId);
    proposal.acceptedBy.push(acceptorId);
    proposal.status = 'accepted';
    return newState;
}
/**
 * Decline a trade proposal
 */
export function declineTradeProposal(state, tradeId, declinerId) {
    const newState = JSON.parse(JSON.stringify(state));
    const proposal = newState.tradeProposals.find(t => t.id === tradeId);
    if (!proposal || proposal.status !== 'pending') {
        return newState; // Already handled or doesn't exist
    }
    // Cannot decline your own proposal (just cancel it instead)
    if (declinerId === proposal.proposerId) {
        return newState;
    }
    proposal.currentDeclines++;
    // Auto-delete if all players declined
    const potentialAcceptors = proposal.targetId
        ? 1
        : newState.players.length - 1; // All except proposer
    if (proposal.currentDeclines >= potentialAcceptors) {
        proposal.status = 'expired';
        // Remove expired proposals
        newState.tradeProposals = newState.tradeProposals.filter(t => t.id !== tradeId);
    }
    return newState;
}
/**
 * Cancel a trade proposal (only proposer can cancel)
 */
export function cancelTradeProposal(state, tradeId, playerId) {
    const newState = JSON.parse(JSON.stringify(state));
    const proposal = newState.tradeProposals.find(t => t.id === tradeId);
    if (!proposal || proposal.proposerId !== playerId) {
        return newState;
    }
    // Remove the proposal
    newState.tradeProposals = newState.tradeProposals.filter(t => t.id !== tradeId);
    return newState;
}
/**
 * Validate executing a trade
 * Trade can only execute if one participant is the active player
 */
export function validateExecuteTrade(state, tradeId) {
    const proposal = state.tradeProposals.find(t => t.id === tradeId);
    if (!proposal) {
        return { ok: false, reason: 'Trade proposal not found' };
    }
    if (proposal.status !== 'accepted') {
        return { ok: false, reason: 'Trade not accepted' };
    }
    if (proposal.acceptedBy.length === 0) {
        return { ok: false, reason: 'No acceptors' };
    }
    // Get current player
    const currentPlayerId = state.players[state.currentPlayerIdx].id;
    // Either proposer or one acceptor must be current player
    const proposerIsActive = proposal.proposerId === currentPlayerId;
    const acceptorIsActive = proposal.acceptedBy.includes(currentPlayerId);
    if (!proposerIsActive && !acceptorIsActive) {
        return { ok: false, reason: 'Trade can only execute on a participant\'s turn' };
    }
    // Select acceptor (if multiple, pick one - we'll handle this in execution)
    const acceptorId = proposal.acceptedBy[0]; // For now, take first
    const proposer = state.players.find(p => p.id === proposal.proposerId);
    const acceptor = state.players.find(p => p.id === acceptorId);
    if (!proposer || !acceptor) {
        return { ok: false, reason: 'Player not found' };
    }
    // Verify both players still have resources
    if (!hasOfferResources(proposer, proposal.offering)) {
        return { ok: false, reason: 'Proposer no longer has offered resources' };
    }
    if (!hasOfferResources(acceptor, proposal.requesting)) {
        return { ok: false, reason: 'Acceptor no longer has requested resources' };
    }
    return { ok: true };
}
/**
 * Execute a trade between two players
 */
export function executeTrade(state, tradeId, acceptorId // If multiple acceptors, specify which one
) {
    const validation = validateExecuteTrade(state, tradeId);
    if (!validation.ok) {
        throw new Error(`Cannot execute trade: ${validation.reason}`);
    }
    const newState = JSON.parse(JSON.stringify(state));
    const proposal = newState.tradeProposals.find(t => t.id === tradeId);
    // Select acceptor
    const selectedAcceptorId = acceptorId || proposal.acceptedBy[0];
    if (!proposal.acceptedBy.includes(selectedAcceptorId)) {
        throw new Error('Invalid acceptor');
    }
    const proposer = newState.players.find(p => p.id === proposal.proposerId);
    const acceptor = newState.players.find(p => p.id === selectedAcceptorId);
    // Transfer current resources
    // Proposer gives, acceptor receives
    for (const resource of Object.values(ResourceEnum)) {
        if (resource === ResourceEnum.DESERT)
            continue;
        const offeringAmount = proposal.offering.current[resource] || 0;
        if (offeringAmount > 0) {
            proposer.resources[resource] -= offeringAmount;
            acceptor.resources[resource] += offeringAmount;
        }
    }
    // Acceptor gives, proposer receives
    for (const resource of Object.values(ResourceEnum)) {
        if (resource === ResourceEnum.DESERT)
            continue;
        const requestingAmount = proposal.requesting.current[resource] || 0;
        if (requestingAmount > 0) {
            acceptor.resources[resource] -= requestingAmount;
            proposer.resources[resource] += requestingAmount;
        }
    }
    // Mark as executed and remove
    proposal.status = 'executed';
    newState.tradeProposals = newState.tradeProposals.filter(t => t.id !== tradeId);
    // Note: Futures trading would need additional tracking
    // For now, we're only implementing current resource trades
    // Futures can be added by tracking promises and settling on next turn
    return newState;
}
/**
 * Create a counter offer
 */
export function createCounterOffer(state, originalTradeId, countererId, offering, requesting) {
    const originalProposal = state.tradeProposals.find(t => t.id === originalTradeId);
    if (!originalProposal || originalProposal.status !== 'pending') {
        throw new Error('Original proposal not found or not pending');
    }
    // Create new proposal as counter
    const newState = createTradeProposal(state, countererId, originalProposal.proposerId, // Counter is directed at original proposer
    offering, requesting);
    // Link back to original
    const counterProposal = newState.tradeProposals[newState.tradeProposals.length - 1];
    // Add to original's counter offers list
    const original = newState.tradeProposals.find(t => t.id === originalTradeId);
    original.counterOffers.push(counterProposal.id);
    original.status = 'countered';
    return newState;
}
//# sourceMappingURL=trade.js.map