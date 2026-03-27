// Core type definitions for the Catan-like game

export const Resource = {
  ORE: 'ore',
  SHEEP: 'sheep',
  WOOD: 'wood',
  BRICK: 'brick',
  WHEAT: 'wheat',
  DESERT: 'desert'
};

export const TileShape = {
  PENTAGON: 5,
  HEXAGON: 6,
  HEPTAGON: 7
};

// Building costs
export const BUILDING_COSTS = {
  road: { [Resource.BRICK]: 1, [Resource.WOOD]: 1 },
  settlement: {
    [Resource.BRICK]: 1,
    [Resource.WOOD]: 1,
    [Resource.SHEEP]: 1,
    [Resource.WHEAT]: 1
  },
  city: { [Resource.WHEAT]: 2, [Resource.ORE]: 3 },
  developmentCard: {
    [Resource.SHEEP]: 1,
    [Resource.WHEAT]: 1,
    [Resource.ORE]: 1
  },
  // Military game mode costs
  militaryKnight: {
    [Resource.ORE]: 3,
    [Resource.WHEAT]: 3,
    [Resource.SHEEP]: 3
  },
  wagon: {
    [Resource.WOOD]: 2,
    [Resource.WHEAT]: 2
  },
  fleet: {
    [Resource.WOOD]: 3,
    [Resource.SHEEP]: 3
  }
};

// Maintenance costs (per turn)
export const MAINTENANCE_COSTS = {
  militaryKnight: {
    [Resource.WHEAT]: 1,
    [Resource.SHEEP]: 1
  },
  wagon: {
    [Resource.WHEAT]: 1
  },
  fleet: {
    [Resource.WOOD]: 1,
    [Resource.SHEEP]: 1
  }
};

// Victory points
export const VICTORY_POINTS = {
  settlement: 1,
  city: 2,
  longestRoad: 2,
  largestArmy: 2
};

// Constants
export const MIN_LONGEST_ROAD = 5;
export const MIN_LARGEST_ARMY = 3;
export const ROBBER_DISCARD_THRESHOLD = 7;
