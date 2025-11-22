// AI personalities and decision-making
import { Resource as ResourceEnum } from '../models/types.js';
import { createTradeProposal } from './trading.js';
// Resource value weights for each AI personality
const RESOURCE_VALUES = {
    robert: {
        // Robert values wood and brick for roads
        [ResourceEnum.WOOD]: 1.5,
        [ResourceEnum.BRICK]: 1.5,
        [ResourceEnum.WHEAT]: 1.0,
        [ResourceEnum.SHEEP]: 1.0,
        [ResourceEnum.ORE]: 0.8,
        [ResourceEnum.DESERT]: 0
    },
    lenore: {
        // Lenore values ore twice as much (for cities)
        [ResourceEnum.ORE]: 2.0,
        [ResourceEnum.WHEAT]: 1.2, // Also needed for cities
        [ResourceEnum.WOOD]: 0.8,
        [ResourceEnum.BRICK]: 0.8,
        [ResourceEnum.SHEEP]: 0.9,
        [ResourceEnum.DESERT]: 0
    },
    trey: {
        // Trey doesn't value diversification - willing to accumulate gluts
        [ResourceEnum.WOOD]: 1.0,
        [ResourceEnum.BRICK]: 1.0,
        [ResourceEnum.WHEAT]: 1.0,
        [ResourceEnum.SHEEP]: 1.0,
        [ResourceEnum.ORE]: 1.0,
        [ResourceEnum.DESERT]: 0
    },
    bob: {
        // Bob is balanced
        [ResourceEnum.WOOD]: 1.0,
        [ResourceEnum.BRICK]: 1.0,
        [ResourceEnum.WHEAT]: 1.0,
        [ResourceEnum.SHEEP]: 1.0,
        [ResourceEnum.ORE]: 1.0,
        [ResourceEnum.DESERT]: 0
    }
};
// Evaluate a trade offer based on AI personality
export function evaluateTradeOffer(player, giving, receiving) {
    if (!player.aiPersonality)
        return 0;
    const values = RESOURCE_VALUES[player.aiPersonality];
    // Calculate value of what we're giving away (negative)
    let givingValue = 0;
    for (const [resource, amount] of Object.entries(giving.current)) {
        if (amount) {
            givingValue += values[resource] * amount;
        }
    }
    for (const [resource, amount] of Object.entries(giving.future)) {
        if (amount) {
            givingValue += values[resource] * amount * 0.7; // Future resources worth less
        }
    }
    // Calculate value of what we're receiving (positive)
    let receivingValue = 0;
    for (const [resource, amount] of Object.entries(receiving.current)) {
        if (amount) {
            receivingValue += values[resource] * amount;
        }
    }
    for (const [resource, amount] of Object.entries(receiving.future)) {
        if (amount) {
            receivingValue += values[resource] * amount * 0.7;
        }
    }
    // Special case for Trey - he's more willing to trade even if slightly unfavorable
    if (player.aiPersonality === 'trey') {
        // Trey gets a bonus for trading itself
        return (receivingValue - givingValue) * 0.8; // Accept trades more readily
    }
    // Special case for Lenore - prefers to hoard ore
    if (player.aiPersonality === 'lenore') {
        // Extra penalty for giving away ore
        for (const [resource, amount] of Object.entries(giving.current)) {
            if (resource === ResourceEnum.ORE && amount) {
                givingValue += amount * 0.5; // Extra cost to give away ore
            }
        }
    }
    return receivingValue - givingValue;
}
// AI decides whether to accept a trade proposal
export function aiShouldAcceptTrade(player, proposal) {
    if (!player.isAI || !player.aiPersonality)
        return false;
    // Determine which offer is ours
    const isProposer = player.id === proposal.proposerId;
    const ourOffer = isProposer ? proposal.proposerOffer : proposal.recipientOffer;
    const theirOffer = isProposer ? proposal.recipientOffer : proposal.proposerOffer;
    const tradeValue = evaluateTradeOffer(player, ourOffer, theirOffer);
    // Accept if trade value is positive
    // Add some randomness for variety
    const threshold = player.aiPersonality === 'trey' ? -0.5 : 0;
    return tradeValue > threshold;
}
// AI generates a trade proposal
export function aiGenerateTradeProposal(state, aiPlayer, rng) {
    if (!aiPlayer.isAI || !aiPlayer.aiPersonality)
        return null;
    const personality = aiPlayer.aiPersonality;
    const values = RESOURCE_VALUES[personality];
    // Determine what AI wants and what it has excess of
    const wants = [];
    const hasExcess = [];
    const resourceList = [
        ResourceEnum.WOOD,
        ResourceEnum.BRICK,
        ResourceEnum.WHEAT,
        ResourceEnum.SHEEP,
        ResourceEnum.ORE
    ];
    // Robert wants wood/brick for roads
    if (personality === 'robert') {
        if (aiPlayer.resources[ResourceEnum.WOOD] < 3)
            wants.push(ResourceEnum.WOOD);
        if (aiPlayer.resources[ResourceEnum.BRICK] < 3)
            wants.push(ResourceEnum.BRICK);
    }
    // Lenore wants ore/wheat for cities
    if (personality === 'lenore') {
        if (aiPlayer.resources[ResourceEnum.ORE] < 5)
            wants.push(ResourceEnum.ORE);
        if (aiPlayer.resources[ResourceEnum.WHEAT] < 3)
            wants.push(ResourceEnum.WHEAT);
    }
    // Find excess resources
    for (const resource of resourceList) {
        if (aiPlayer.resources[resource] > 3) {
            hasExcess.push(resource);
        }
    }
    // Trey is willing to trade anything for what he's accumulating
    if (personality === 'trey' && hasExcess.length > 0) {
        // Pick a resource to accumulate more of
        const targetResource = hasExcess[rng.nextInt(0, hasExcess.length - 1)];
        wants.push(targetResource);
    }
    // Bob is balanced - wants what he's short on
    if (personality === 'bob') {
        for (const resource of resourceList) {
            if (aiPlayer.resources[resource] < 2) {
                wants.push(resource);
            }
        }
    }
    if (wants.length === 0 || hasExcess.length === 0) {
        return null; // Nothing to trade
    }
    // Pick a trade partner (not ourselves)
    const otherPlayers = state.players.filter(p => p.id !== aiPlayer.id);
    if (otherPlayers.length === 0)
        return null;
    const partner = otherPlayers[rng.nextInt(0, otherPlayers.length - 1)];
    // Create offer
    const wantResource = wants[rng.nextInt(0, wants.length - 1)];
    const giveResource = hasExcess[rng.nextInt(0, hasExcess.length - 1)];
    // Determine amounts (1-3 resources)
    const giveAmount = Math.min(rng.nextInt(1, 3), aiPlayer.resources[giveResource] - 1 // Keep at least 1
    );
    const wantAmount = Math.max(1, Math.floor(giveAmount * 0.8)); // Slightly favorable to AI
    if (giveAmount <= 0)
        return null;
    const aiOffer = {
        current: { [giveResource]: giveAmount },
        future: {}
    };
    const partnerOffer = {
        current: { [wantResource]: wantAmount },
        future: {}
    };
    const result = createTradeProposal(state, aiPlayer.id, aiOffer, partner.id, partnerOffer);
    return result.valid ? result.proposal : null;
}
// AI makes a counter-offer
export function aiMakeCounterOffer(state, aiPlayer, originalProposal, rng) {
    if (!aiPlayer.isAI || !aiPlayer.aiPersonality)
        return null;
    const isRecipient = aiPlayer.id === originalProposal.recipientId;
    const originalAiOffer = isRecipient ? originalProposal.recipientOffer : originalProposal.proposerOffer;
    const originalOtherOffer = isRecipient ? originalProposal.proposerOffer : originalProposal.recipientOffer;
    // Evaluate original offer
    const originalValue = evaluateTradeOffer(aiPlayer, originalAiOffer, originalOtherOffer);
    // If already good, accept instead
    if (originalValue > 0)
        return null;
    // Create counter-offer by adjusting amounts
    const counterAiOffer = {
        current: {},
        future: {}
    };
    const counterOtherOffer = {
        current: {},
        future: {}
    };
    // Reduce what we give or increase what we get
    for (const [resource, amount] of Object.entries(originalAiOffer.current)) {
        if (amount) {
            // Offer less
            counterAiOffer.current[resource] = Math.max(1, Math.floor(amount * 0.7));
        }
    }
    for (const [resource, amount] of Object.entries(originalOtherOffer.current)) {
        if (amount) {
            // Ask for more
            counterOtherOffer.current[resource] = Math.ceil(amount * 1.3);
        }
    }
    // Ensure valid offer
    const totalAi = Object.values(counterAiOffer.current).reduce((s, v) => s + (v || 0), 0);
    const totalOther = Object.values(counterOtherOffer.current).reduce((s, v) => s + (v || 0), 0);
    if (totalAi === 0 || totalOther === 0)
        return null;
    const otherId = isRecipient ? originalProposal.proposerId : originalProposal.recipientId;
    const result = createTradeProposal(state, aiPlayer.id, counterAiOffer, otherId, counterOtherOffer);
    return result.valid ? result.proposal : null;
}
// AI decides on best build action based on personality
export function aiDecideBuildAction(player, state) {
    if (!player.isAI || !player.aiPersonality)
        return null;
    const personality = player.aiPersonality;
    // Robert prioritizes roads
    if (personality === 'robert') {
        // Can build road?
        if (player.resources[ResourceEnum.WOOD] >= 1 && player.resources[ResourceEnum.BRICK] >= 1) {
            return 'road';
        }
    }
    // Lenore prioritizes cities
    if (personality === 'lenore') {
        // Can build city?
        if (player.resources[ResourceEnum.WHEAT] >= 2 && player.resources[ResourceEnum.ORE] >= 3) {
            if (player.settlements.length > 0) {
                return 'city';
            }
        }
    }
    // Bob is balanced - follows standard strategy
    if (personality === 'bob') {
        // Prefer cities if possible
        if (player.resources[ResourceEnum.WHEAT] >= 2 &&
            player.resources[ResourceEnum.ORE] >= 3 &&
            player.settlements.length > 0) {
            return 'city';
        }
        // Then settlements
        if (player.resources[ResourceEnum.WOOD] >= 1 &&
            player.resources[ResourceEnum.BRICK] >= 1 &&
            player.resources[ResourceEnum.SHEEP] >= 1 &&
            player.resources[ResourceEnum.WHEAT] >= 1) {
            return 'settlement';
        }
        // Then roads
        if (player.resources[ResourceEnum.WOOD] >= 1 && player.resources[ResourceEnum.BRICK] >= 1) {
            return 'road';
        }
    }
    // Trey - flexible, builds whatever he can
    if (personality === 'trey') {
        if (player.resources[ResourceEnum.WHEAT] >= 2 &&
            player.resources[ResourceEnum.ORE] >= 3 &&
            player.settlements.length > 0) {
            return 'city';
        }
        if (player.resources[ResourceEnum.WOOD] >= 1 &&
            player.resources[ResourceEnum.BRICK] >= 1 &&
            player.resources[ResourceEnum.SHEEP] >= 1 &&
            player.resources[ResourceEnum.WHEAT] >= 1) {
            return 'settlement';
        }
        if (player.resources[ResourceEnum.WOOD] >= 1 && player.resources[ResourceEnum.BRICK] >= 1) {
            return 'road';
        }
    }
    return null;
}
//# sourceMappingURL=ai.js.map