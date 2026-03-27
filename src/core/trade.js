// Trade proposal logic and validation

import { Resource } from '../models/types.js';
import { generateId } from './utils.js';

function isValidResourceOffer(offer, allowFutures) {
  const current = offer.current;
  const futures = offer.futures || {};

  let totalCurrent = 0;
  let totalFutures = 0;

  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;

    const amount = current[resource] || 0;
    if (amount < 0 || !Number.isInteger(amount)) {
      return false;
    }
    totalCurrent += amount;
  }

  if (allowFutures && futures) {
    for (const resource of Object.values(Resource)) {
      if (resource === Resource.DESERT) continue;

      const amount = futures[resource] || 0;
      if (amount < 0 || !Number.isInteger(amount)) {
        return false;
      }
      totalFutures += amount;
    }
  } else if (futures && Object.values(futures).some(v => v > 0)) {
    return false;
  }

  return totalCurrent + totalFutures > 0;
}

function hasOfferResources(player, offer) {
  const current = offer.current;

  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;

    const amount = current[resource] || 0;
    if (player.resources[resource] < amount) {
      return false;
    }
  }

  return true;
}

export function validateCreateTradeProposal(state, proposerId, targetId, offering, requesting) {
  const proposer = state.players.find(p => p.id === proposerId);
  if (!proposer) {
    return { ok: false, reason: 'Proposer not found' };
  }

  if (targetId) {
    const target = state.players.find(p => p.id === targetId);
    if (!target) {
      return { ok: false, reason: 'Target player not found' };
    }
    if (targetId === proposerId) {
      return { ok: false, reason: 'Cannot trade with yourself' };
    }
  }

  const futuresEnabled = state.options.futuresTrading || false;
  if (!isValidResourceOffer(offering, futuresEnabled)) {
    return { ok: false, reason: 'Invalid offering' };
  }
  if (!isValidResourceOffer(requesting, futuresEnabled)) {
    return { ok: false, reason: 'Invalid request' };
  }

  if (!hasOfferResources(proposer, offering)) {
    return { ok: false, reason: 'Insufficient resources to offer' };
  }

  return { ok: true };
}

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
    createdTurn: newState.diceHistory.length,
    currentDeclines: 0
  };

  newState.tradeProposals.push(proposal);
  return newState;
}

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

  if (acceptorId === proposal.proposerId) {
    return { ok: false, reason: 'Cannot accept your own proposal' };
  }

  if (proposal.targetId && proposal.targetId !== acceptorId) {
    return { ok: false, reason: 'This trade is for another player' };
  }

  if (proposal.acceptedBy.includes(acceptorId)) {
    return { ok: false, reason: 'Already accepted this proposal' };
  }

  if (!hasOfferResources(acceptor, proposal.requesting)) {
    return { ok: false, reason: 'Insufficient resources to accept' };
  }

  return { ok: true };
}

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

export function declineTradeProposal(state, tradeId, declinerId) {
  const newState = JSON.parse(JSON.stringify(state));
  const proposal = newState.tradeProposals.find(t => t.id === tradeId);

  if (!proposal || proposal.status !== 'pending') {
    return newState;
  }

  if (declinerId === proposal.proposerId) {
    return newState;
  }

  proposal.currentDeclines++;

  const potentialAcceptors = proposal.targetId
    ? 1
    : newState.players.length - 1;

  if (proposal.currentDeclines >= potentialAcceptors) {
    proposal.status = 'expired';
    newState.tradeProposals = newState.tradeProposals.filter(t => t.id !== tradeId);
  }

  return newState;
}

export function cancelTradeProposal(state, tradeId, playerId) {
  const newState = JSON.parse(JSON.stringify(state));
  const proposal = newState.tradeProposals.find(t => t.id === tradeId);

  if (!proposal || proposal.proposerId !== playerId) {
    return newState;
  }

  newState.tradeProposals = newState.tradeProposals.filter(t => t.id !== tradeId);
  return newState;
}

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

  const currentPlayerId = state.players[state.currentPlayerIdx].id;

  const proposerIsActive = proposal.proposerId === currentPlayerId;
  const acceptorIsActive = proposal.acceptedBy.includes(currentPlayerId);

  if (!proposerIsActive && !acceptorIsActive) {
    return { ok: false, reason: 'Trade can only execute on a participant\'s turn' };
  }

  const acceptorId = proposal.acceptedBy[0];

  const proposer = state.players.find(p => p.id === proposal.proposerId);
  const acceptor = state.players.find(p => p.id === acceptorId);

  if (!proposer || !acceptor) {
    return { ok: false, reason: 'Player not found' };
  }

  if (!hasOfferResources(proposer, proposal.offering)) {
    return { ok: false, reason: 'Proposer no longer has offered resources' };
  }

  if (!hasOfferResources(acceptor, proposal.requesting)) {
    return { ok: false, reason: 'Acceptor no longer has requested resources' };
  }

  return { ok: true };
}

export function executeTrade(state, tradeId, acceptorId) {
  const validation = validateExecuteTrade(state, tradeId);
  if (!validation.ok) {
    throw new Error(`Cannot execute trade: ${validation.reason}`);
  }

  const newState = JSON.parse(JSON.stringify(state));
  const proposal = newState.tradeProposals.find(t => t.id === tradeId);

  const selectedAcceptorId = acceptorId || proposal.acceptedBy[0];
  if (!proposal.acceptedBy.includes(selectedAcceptorId)) {
    throw new Error('Invalid acceptor');
  }

  const proposer = newState.players.find(p => p.id === proposal.proposerId);
  const acceptor = newState.players.find(p => p.id === selectedAcceptorId);

  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;

    const offeringAmount = proposal.offering.current[resource] || 0;
    if (offeringAmount > 0) {
      proposer.resources[resource] -= offeringAmount;
      acceptor.resources[resource] += offeringAmount;
    }
  }

  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;

    const requestingAmount = proposal.requesting.current[resource] || 0;
    if (requestingAmount > 0) {
      acceptor.resources[resource] -= requestingAmount;
      proposer.resources[resource] += requestingAmount;
    }
  }

  proposal.status = 'executed';
  newState.tradeProposals = newState.tradeProposals.filter(t => t.id !== tradeId);

  return newState;
}

export function createCounterOffer(state, originalTradeId, countererId, offering, requesting) {
  const originalProposal = state.tradeProposals.find(t => t.id === originalTradeId);
  if (!originalProposal || originalProposal.status !== 'pending') {
    throw new Error('Original proposal not found or not pending');
  }

  const newState = createTradeProposal(
    state,
    countererId,
    originalProposal.proposerId,
    offering,
    requesting
  );

  const counterProposal = newState.tradeProposals[newState.tradeProposals.length - 1];

  const original = newState.tradeProposals.find(t => t.id === originalTradeId);
  original.counterOffers.push(counterProposal.id);
  original.status = 'countered';

  return newState;
}
