// AI player personalities and decision-making logic

import type {
  GameState,
  Player,
  Resource,
  AIPersonality,
  ResourceOffer,
  TradeProposal,
  ID
} from '../models/types.js';
import { Resource as ResourceEnum, BUILDING_COSTS } from '../models/types.js';
import { SeededRandom } from './utils.js';

/**
 * Resource value weights for different AI personalities
 */
const PERSONALITY_WEIGHTS: Record<AIPersonality, Record<Resource, number>> = {
  // Robert: Values longest road, prioritizes brick and wood for roads
  robert: {
    [ResourceEnum.BRICK]: 1.5,
    [ResourceEnum.WOOD]: 1.5,
    [ResourceEnum.ORE]: 0.8,
    [ResourceEnum.SHEEP]: 0.8,
    [ResourceEnum.WHEAT]: 0.8,
    [ResourceEnum.DESERT]: 0
  },

  // Lenore: Values ore twice as highly, focuses on cities
  lenore: {
    [ResourceEnum.ORE]: 2.0,
    [ResourceEnum.WHEAT]: 1.3, // Also needed for cities
    [ResourceEnum.BRICK]: 0.7,
    [ResourceEnum.WOOD]: 0.7,
    [ResourceEnum.SHEEP]: 0.7,
    [ResourceEnum.DESERT]: 0
  },

  // Trey: Doesn't value diversification, willing to have resource gluts
  trey: {
    [ResourceEnum.ORE]: 1.0,
    [ResourceEnum.SHEEP]: 1.0,
    [ResourceEnum.WOOD]: 1.0,
    [ResourceEnum.BRICK]: 1.0,
    [ResourceEnum.WHEAT]: 1.0,
    [ResourceEnum.DESERT]: 0
  },

  // Bob: Balanced approach
  bob: {
    [ResourceEnum.ORE]: 1.0,
    [ResourceEnum.SHEEP]: 1.0,
    [ResourceEnum.WOOD]: 1.0,
    [ResourceEnum.BRICK]: 1.0,
    [ResourceEnum.WHEAT]: 1.0,
    [ResourceEnum.DESERT]: 0
  }
};

/**
 * Calculate the value of a resource offer based on AI personality
 */
function evaluateResourceOffer(
  offer: ResourceOffer,
  personality: AIPersonality
): number {
  const weights = PERSONALITY_WEIGHTS[personality];
  let value = 0;

  for (const resource of Object.values(ResourceEnum)) {
    if (resource === ResourceEnum.DESERT) continue;

    const currentAmount = offer.current[resource] || 0;
    const futuresAmount = offer.futures?.[resource] || 0;

    // Current resources are worth full value, futures worth 80%
    value += currentAmount * weights[resource];
    value += futuresAmount * weights[resource] * 0.8;
  }

  return value;
}

/**
 * Calculate resource diversity score (lower is more diverse)
 * Trey doesn't care about this, others do
 */
function calculateDiversityPenalty(
  resources: Record<Resource, number>,
  personality: AIPersonality
): number {
  if (personality === 'trey') {
    return 0; // Trey doesn't care about diversity
  }

  const amounts: number[] = [];
  for (const resource of Object.values(ResourceEnum)) {
    if (resource === ResourceEnum.DESERT) continue;
    amounts.push(resources[resource]);
  }

  // Calculate variance - high variance means poor diversity
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length;

  // Bob and Robert care about diversity, Lenore somewhat
  const diversityWeight = personality === 'bob' ? 0.3 :
                         personality === 'robert' ? 0.25 :
                         0.15; // lenore

  return variance * diversityWeight;
}

/**
 * Determine what resources AI needs based on personality
 */
function getDesiredResources(
  player: Player,
  state: GameState
): Partial<Record<Resource, number>> {
  const personality = player.aiPersonality!;
  const desired: Partial<Record<Resource, number>> = {};

  switch (personality) {
    case 'robert':
      // Robert wants to build roads for longest road
      desired[ResourceEnum.BRICK] = 3;
      desired[ResourceEnum.WOOD] = 3;
      // Also needs some settlement resources
      desired[ResourceEnum.SHEEP] = 1;
      desired[ResourceEnum.WHEAT] = 1;
      break;

    case 'lenore':
      // Lenore wants to build cities before expanding
      desired[ResourceEnum.ORE] = 4;
      desired[ResourceEnum.WHEAT] = 3;
      // Minimal expansion resources
      desired[ResourceEnum.BRICK] = 1;
      desired[ResourceEnum.WOOD] = 1;
      desired[ResourceEnum.SHEEP] = 1;
      break;

    case 'trey':
      // Trey is willing to accumulate whatever they can trade for
      // Focus on what they have most of
      const mostResource = (Object.entries(player.resources) as [Resource, number][])
        .filter(([r]) => r !== ResourceEnum.DESERT)
        .sort((a, b) => b[1] - a[1])[0];
      if (mostResource) {
        desired[mostResource[0]] = 5; // Accumulate more of what they have
      }
      break;

    case 'bob':
      // Bob wants balanced resources for all building types
      desired[ResourceEnum.ORE] = 2;
      desired[ResourceEnum.SHEEP] = 2;
      desired[ResourceEnum.WOOD] = 2;
      desired[ResourceEnum.BRICK] = 2;
      desired[ResourceEnum.WHEAT] = 2;
      break;
  }

  return desired;
}

/**
 * Decide whether AI should accept a trade proposal
 */
export function shouldAcceptTrade(
  state: GameState,
  proposal: TradeProposal,
  aiPlayerId: ID,
  rng?: SeededRandom
): boolean {
  const aiPlayer = state.players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.aiPersonality) {
    return false;
  }

  const personality = aiPlayer.aiPersonality;

  // Can't accept if we don't have the resources
  const requesting = proposal.requesting;
  for (const resource of Object.values(ResourceEnum)) {
    if (resource === ResourceEnum.DESERT) continue;
    const amount = requesting.current[resource] || 0;
    if (aiPlayer.resources[resource] < amount) {
      return false;
    }
  }

  // Evaluate the trade
  const offeringValue = evaluateResourceOffer(proposal.offering, personality);
  const requestingValue = evaluateResourceOffer(proposal.requesting, personality);

  // Calculate what resources we'd have after trade
  const resourcesAfter = { ...aiPlayer.resources };
  for (const resource of Object.values(ResourceEnum)) {
    if (resource === ResourceEnum.DESERT) continue;
    resourcesAfter[resource] += (proposal.offering.current[resource] || 0);
    resourcesAfter[resource] -= (proposal.requesting.current[resource] || 0);
  }

  const diversityPenaltyBefore = calculateDiversityPenalty(aiPlayer.resources, personality);
  const diversityPenaltyAfter = calculateDiversityPenalty(resourcesAfter, personality);

  // Total value including diversity considerations
  const totalValueGained = offeringValue - requestingValue + (diversityPenaltyBefore - diversityPenaltyAfter);

  // Trey is more willing to trade even for equal value
  const threshold = personality === 'trey' ? -0.5 : 0.2;

  // Add some randomness
  const random = rng || new SeededRandom();
  const randomFactor = random.next() * 0.3 - 0.15; // -0.15 to +0.15

  return (totalValueGained + randomFactor) > threshold;
}

/**
 * Generate a trade proposal from AI
 */
export function generateAITradeProposal(
  state: GameState,
  aiPlayerId: ID,
  rng?: SeededRandom
): { targetId: ID | null; offering: ResourceOffer; requesting: ResourceOffer } | null {
  const aiPlayer = state.players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.aiPersonality) {
    return null;
  }

  const personality = aiPlayer.aiPersonality;
  const random = rng || new SeededRandom();

  // Get what resources AI wants
  const desired = getDesiredResources(aiPlayer, state);

  // Find what we have excess of
  const excess: Partial<Record<Resource, number>> = {};
  for (const resource of Object.values(ResourceEnum)) {
    if (resource === ResourceEnum.DESERT) continue;

    const have = aiPlayer.resources[resource];
    const want = desired[resource] || 1;

    if (have > want + 1) {
      excess[resource] = have - want;
    }
  }

  // Find what we're short on
  const needed: Partial<Record<Resource, number>> = {};
  for (const resource of Object.values(ResourceEnum)) {
    if (resource === ResourceEnum.DESERT) continue;

    const have = aiPlayer.resources[resource];
    const want = desired[resource] || 1;

    if (have < want) {
      needed[resource] = want - have;
    }
  }

  // Can't make a trade if we have nothing to offer or don't need anything
  if (Object.keys(excess).length === 0 || Object.keys(needed).length === 0) {
    return null;
  }

  // Create a trade proposal
  const offering: ResourceOffer = { current: {} as Record<Resource, number> };
  const requesting: ResourceOffer = { current: {} as Record<Resource, number> };

  // Initialize all resources to 0
  for (const resource of Object.values(ResourceEnum)) {
    offering.current[resource] = 0;
    requesting.current[resource] = 0;
  }

  // Offer some excess resources (1-2 of one type)
  const excessResources = Object.keys(excess) as Resource[];
  const offerResource = excessResources[Math.floor(random.next() * excessResources.length)];
  offering.current[offerResource] = Math.min(
    excess[offerResource]!,
    1 + Math.floor(random.next() * 2)
  );

  // Request needed resources (1-2 of one type)
  const neededResources = Object.keys(needed) as Resource[];
  const requestResource = neededResources[Math.floor(random.next() * neededResources.length)];
  requesting.current[requestResource] = Math.min(
    needed[requestResource]!,
    1 + Math.floor(random.next() * 2)
  );

  // Trey might request more to build up a glut
  if (personality === 'trey') {
    requesting.current[requestResource] = Math.min(
      requesting.current[requestResource] + 1,
      3
    );
  }

  // 50% chance to target a specific player, otherwise open trade
  const targetId = random.next() > 0.5
    ? state.players
        .filter(p => p.id !== aiPlayerId)
        [Math.floor(random.next() * (state.players.length - 1))].id
    : null;

  return { targetId, offering, requesting };
}

/**
 * Generate a counter offer from AI
 */
export function generateAICounterOffer(
  state: GameState,
  originalProposal: TradeProposal,
  aiPlayerId: ID,
  rng?: SeededRandom
): { offering: ResourceOffer; requesting: ResourceOffer } | null {
  const aiPlayer = state.players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.aiPersonality) {
    return null;
  }

  const random = rng || new SeededRandom();

  // Counter by adjusting the amounts slightly
  const offering: ResourceOffer = JSON.parse(JSON.stringify(originalProposal.requesting));
  const requesting: ResourceOffer = JSON.parse(JSON.stringify(originalProposal.offering));

  // Randomly adjust one resource amount
  const resources = Object.values(ResourceEnum).filter(r => r !== ResourceEnum.DESERT);
  const adjustResource = resources[Math.floor(random.next() * resources.length)];

  // Increase what we want or decrease what we give
  if (random.next() > 0.5 && requesting.current[adjustResource] > 0) {
    requesting.current[adjustResource]++;
  } else if (offering.current[adjustResource] > 0) {
    offering.current[adjustResource]--;
  }

  return { offering, requesting };
}

/**
 * Determine AI's preferred building action based on personality
 */
export function getAIBuildingPriority(
  player: Player,
  state: GameState
): 'road' | 'settlement' | 'city' | 'developmentCard' | null {
  if (!player.aiPersonality) return null;

  const personality = player.aiPersonality;

  switch (personality) {
    case 'robert':
      // Robert prioritizes roads for longest road
      if (player.resources[ResourceEnum.BRICK] >= 1 && player.resources[ResourceEnum.WOOD] >= 1) {
        return 'road';
      }
      // Then settlements to expand network
      if (player.resources[ResourceEnum.BRICK] >= 1 &&
          player.resources[ResourceEnum.WOOD] >= 1 &&
          player.resources[ResourceEnum.SHEEP] >= 1 &&
          player.resources[ResourceEnum.WHEAT] >= 1) {
        return 'settlement';
      }
      break;

    case 'lenore':
      // Lenore prioritizes cities first
      if (player.resources[ResourceEnum.ORE] >= 3 &&
          player.resources[ResourceEnum.WHEAT] >= 2 &&
          player.settlements.length > 0) {
        return 'city';
      }
      // Then settlements only if no cities to build
      if (player.resources[ResourceEnum.BRICK] >= 1 &&
          player.resources[ResourceEnum.WOOD] >= 1 &&
          player.resources[ResourceEnum.SHEEP] >= 1 &&
          player.resources[ResourceEnum.WHEAT] >= 1) {
        return 'settlement';
      }
      break;

    case 'bob':
      // Bob is balanced - prioritize what gives most VP
      if (player.resources[ResourceEnum.ORE] >= 3 &&
          player.resources[ResourceEnum.WHEAT] >= 2 &&
          player.settlements.length > 0) {
        return 'city';
      }
      if (player.resources[ResourceEnum.BRICK] >= 1 &&
          player.resources[ResourceEnum.WOOD] >= 1 &&
          player.resources[ResourceEnum.SHEEP] >= 1 &&
          player.resources[ResourceEnum.WHEAT] >= 1) {
        return 'settlement';
      }
      if (player.resources[ResourceEnum.BRICK] >= 1 &&
          player.resources[ResourceEnum.WOOD] >= 1 &&
          player.longestRoadLength >= 3) {
        return 'road';
      }
      break;

    case 'trey':
      // Trey builds whatever they can with their resource glut
      const totalResources = Object.values(player.resources).reduce((a, b) => a + b, 0);

      if (totalResources >= 5) {
        // Try to build cities if possible
        if (player.resources[ResourceEnum.ORE] >= 3 &&
            player.resources[ResourceEnum.WHEAT] >= 2 &&
            player.settlements.length > 0) {
          return 'city';
        }
        // Otherwise settlements
        if (player.resources[ResourceEnum.BRICK] >= 1 &&
            player.resources[ResourceEnum.WOOD] >= 1 &&
            player.resources[ResourceEnum.SHEEP] >= 1 &&
            player.resources[ResourceEnum.WHEAT] >= 1) {
          return 'settlement';
        }
      }
      break;
  }

  return null;
}
