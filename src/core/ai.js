// AI player personalities and decision-making logic

import { Resource, BUILDING_COSTS } from '../models/types.js';
import { SeededRandom } from './utils.js';

const PERSONALITY_WEIGHTS = {
  robert: {
    [Resource.BRICK]: 1.5,
    [Resource.WOOD]: 1.5,
    [Resource.ORE]: 0.8,
    [Resource.SHEEP]: 0.8,
    [Resource.WHEAT]: 0.8,
    [Resource.DESERT]: 0
  },
  lenore: {
    [Resource.ORE]: 2.0,
    [Resource.WHEAT]: 1.3,
    [Resource.BRICK]: 0.7,
    [Resource.WOOD]: 0.7,
    [Resource.SHEEP]: 0.7,
    [Resource.DESERT]: 0
  },
  trey: {
    [Resource.ORE]: 1.0,
    [Resource.SHEEP]: 1.0,
    [Resource.WOOD]: 1.0,
    [Resource.BRICK]: 1.0,
    [Resource.WHEAT]: 1.0,
    [Resource.DESERT]: 0
  },
  bob: {
    [Resource.ORE]: 1.0,
    [Resource.SHEEP]: 1.0,
    [Resource.WOOD]: 1.0,
    [Resource.BRICK]: 1.0,
    [Resource.WHEAT]: 1.0,
    [Resource.DESERT]: 0
  }
};

function evaluateResourceOffer(offer, personality) {
  const weights = PERSONALITY_WEIGHTS[personality];
  let value = 0;

  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;

    const currentAmount = offer.current[resource] || 0;
    const futuresAmount = offer.futures?.[resource] || 0;

    value += currentAmount * weights[resource];
    value += futuresAmount * weights[resource] * 0.8;
  }

  return value;
}

function calculateDiversityPenalty(resources, personality) {
  if (personality === 'trey') {
    return 0;
  }

  const amounts = [];
  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;
    amounts.push(resources[resource]);
  }

  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length;

  const diversityWeight = personality === 'bob' ? 0.3 :
                         personality === 'robert' ? 0.25 :
                         0.15;

  return variance * diversityWeight;
}

function getDesiredResources(player, state) {
  const personality = player.aiPersonality;
  const desired = {};

  switch (personality) {
    case 'robert':
      desired[Resource.BRICK] = 3;
      desired[Resource.WOOD] = 3;
      desired[Resource.SHEEP] = 1;
      desired[Resource.WHEAT] = 1;
      break;

    case 'lenore':
      desired[Resource.ORE] = 4;
      desired[Resource.WHEAT] = 3;
      desired[Resource.BRICK] = 1;
      desired[Resource.WOOD] = 1;
      desired[Resource.SHEEP] = 1;
      break;

    case 'trey': {
      const mostResource = Object.entries(player.resources)
        .filter(([r]) => r !== Resource.DESERT)
        .sort((a, b) => b[1] - a[1])[0];
      if (mostResource) {
        desired[mostResource[0]] = 5;
      }
      break;
    }

    case 'bob':
      desired[Resource.ORE] = 2;
      desired[Resource.SHEEP] = 2;
      desired[Resource.WOOD] = 2;
      desired[Resource.BRICK] = 2;
      desired[Resource.WHEAT] = 2;
      break;
  }

  return desired;
}

export function shouldAcceptTrade(state, proposal, aiPlayerId, rng) {
  const aiPlayer = state.players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.aiPersonality) {
    return false;
  }

  const personality = aiPlayer.aiPersonality;

  const requesting = proposal.requesting;
  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;
    const amount = requesting.current[resource] || 0;
    if (aiPlayer.resources[resource] < amount) {
      return false;
    }
  }

  const offeringValue = evaluateResourceOffer(proposal.offering, personality);
  const requestingValue = evaluateResourceOffer(proposal.requesting, personality);

  const resourcesAfter = { ...aiPlayer.resources };
  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;
    resourcesAfter[resource] += (proposal.offering.current[resource] || 0);
    resourcesAfter[resource] -= (proposal.requesting.current[resource] || 0);
  }

  const diversityPenaltyBefore = calculateDiversityPenalty(aiPlayer.resources, personality);
  const diversityPenaltyAfter = calculateDiversityPenalty(resourcesAfter, personality);

  const totalValueGained = offeringValue - requestingValue + (diversityPenaltyBefore - diversityPenaltyAfter);

  const threshold = personality === 'trey' ? -0.5 : 0.2;

  const random = rng || new SeededRandom();
  const randomFactor = random.next() * 0.3 - 0.15;

  return (totalValueGained + randomFactor) > threshold;
}

export function generateAITradeProposal(state, aiPlayerId, rng) {
  const aiPlayer = state.players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.aiPersonality) {
    return null;
  }

  const personality = aiPlayer.aiPersonality;
  const random = rng || new SeededRandom();

  const desired = getDesiredResources(aiPlayer, state);

  const excess = {};
  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;

    const have = aiPlayer.resources[resource];
    const want = desired[resource] || 1;

    if (have > want + 1) {
      excess[resource] = have - want;
    }
  }

  const needed = {};
  for (const resource of Object.values(Resource)) {
    if (resource === Resource.DESERT) continue;

    const have = aiPlayer.resources[resource];
    const want = desired[resource] || 1;

    if (have < want) {
      needed[resource] = want - have;
    }
  }

  if (Object.keys(excess).length === 0 || Object.keys(needed).length === 0) {
    return null;
  }

  const offering = { current: {} };
  const requesting = { current: {} };

  for (const resource of Object.values(Resource)) {
    offering.current[resource] = 0;
    requesting.current[resource] = 0;
  }

  const excessResources = Object.keys(excess);
  const offerResource = excessResources[Math.floor(random.next() * excessResources.length)];
  offering.current[offerResource] = Math.min(
    excess[offerResource],
    1 + Math.floor(random.next() * 2)
  );

  const neededResources = Object.keys(needed);
  const requestResource = neededResources[Math.floor(random.next() * neededResources.length)];
  requesting.current[requestResource] = Math.min(
    needed[requestResource],
    1 + Math.floor(random.next() * 2)
  );

  if (personality === 'trey') {
    requesting.current[requestResource] = Math.min(
      requesting.current[requestResource] + 1,
      3
    );
  }

  const targetId = random.next() > 0.5
    ? state.players
        .filter(p => p.id !== aiPlayerId)
        [Math.floor(random.next() * (state.players.length - 1))].id
    : null;

  return { targetId, offering, requesting };
}

export function generateAICounterOffer(state, originalProposal, aiPlayerId, rng) {
  const aiPlayer = state.players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.aiPersonality) {
    return null;
  }

  const random = rng || new SeededRandom();

  const offering = JSON.parse(JSON.stringify(originalProposal.requesting));
  const requesting = JSON.parse(JSON.stringify(originalProposal.offering));

  const resources = Object.values(Resource).filter(r => r !== Resource.DESERT);
  const adjustResource = resources[Math.floor(random.next() * resources.length)];

  if (random.next() > 0.5 && requesting.current[adjustResource] > 0) {
    requesting.current[adjustResource]++;
  } else if (offering.current[adjustResource] > 0) {
    offering.current[adjustResource]--;
  }

  return { offering, requesting };
}

export function getAIBuildingPriority(player, state) {
  if (!player.aiPersonality) return null;

  const personality = player.aiPersonality;

  switch (personality) {
    case 'robert':
      if (player.resources[Resource.BRICK] >= 1 && player.resources[Resource.WOOD] >= 1) {
        return 'road';
      }
      if (player.resources[Resource.BRICK] >= 1 &&
          player.resources[Resource.WOOD] >= 1 &&
          player.resources[Resource.SHEEP] >= 1 &&
          player.resources[Resource.WHEAT] >= 1) {
        return 'settlement';
      }
      break;

    case 'lenore':
      if (player.resources[Resource.ORE] >= 3 &&
          player.resources[Resource.WHEAT] >= 2 &&
          player.settlements.length > 0) {
        return 'city';
      }
      if (player.resources[Resource.BRICK] >= 1 &&
          player.resources[Resource.WOOD] >= 1 &&
          player.resources[Resource.SHEEP] >= 1 &&
          player.resources[Resource.WHEAT] >= 1) {
        return 'settlement';
      }
      break;

    case 'bob':
      if (player.resources[Resource.ORE] >= 3 &&
          player.resources[Resource.WHEAT] >= 2 &&
          player.settlements.length > 0) {
        return 'city';
      }
      if (player.resources[Resource.BRICK] >= 1 &&
          player.resources[Resource.WOOD] >= 1 &&
          player.resources[Resource.SHEEP] >= 1 &&
          player.resources[Resource.WHEAT] >= 1) {
        return 'settlement';
      }
      if (player.resources[Resource.BRICK] >= 1 &&
          player.resources[Resource.WOOD] >= 1 &&
          player.longestRoadLength >= 3) {
        return 'road';
      }
      break;

    case 'trey': {
      const totalResources = Object.values(player.resources).reduce((a, b) => a + b, 0);

      if (totalResources >= 5) {
        if (player.resources[Resource.ORE] >= 3 &&
            player.resources[Resource.WHEAT] >= 2 &&
            player.settlements.length > 0) {
          return 'city';
        }
        if (player.resources[Resource.BRICK] >= 1 &&
            player.resources[Resource.WOOD] >= 1 &&
            player.resources[Resource.SHEEP] >= 1 &&
            player.resources[Resource.WHEAT] >= 1) {
          return 'settlement';
        }
      }
      break;
    }
  }

  return null;
}
