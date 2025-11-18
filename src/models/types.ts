// Core type definitions for the Catan-like game

export type ID = string;

export enum Resource {
  ORE = 'ore',
  SHEEP = 'sheep',
  WOOD = 'wood',
  BRICK = 'brick',
  WHEAT = 'wheat',
  DESERT = 'desert'
}

export enum TileShape {
  PENTAGON = 5,
  HEXAGON = 6,
  HEPTAGON = 7
}

export interface Tile {
  id: ID;
  shape: TileShape;
  polygonPoints?: [number, number][]; // optional for geometry/visual
  resource: Resource;
  diceNumber: number | null; // 2..12 except 7; null for desert
  edges: ID[]; // edge IDs making up tile polygon
  nodes: ID[]; // vertex/node IDs in clockwise order
  robberPresent?: boolean; // true if robber on this tile
  isBoundary?: boolean; // true if tile is on the edge of the map (can have fewer edges/nodes than shape)
}

export interface Node {
  id: ID;
  location?: [number, number]; // optional for coordinate-based maps
  tiles: ID[]; // 1-3 tiles (3 for interior, 1-2 for boundary)
  occupant?: { playerId: ID; type: 'settlement' | 'city' } | null;
  isBoundary?: boolean; // true if node is on the edge of the map (has 1-2 tiles instead of 3)
}

export interface Edge {
  id: ID;
  nodeA: ID;
  nodeB: ID;
  tileLeft?: ID | null; // optional references to adjacent tiles
  tileRight?: ID | null;
  roadOwner?: ID | null; // playerId or null
  isBoundary?: boolean; // true if edge is on the edge of the map (has only one tile)
}

export interface Knight {
  id: ID;
  ownerId: ID;
  nodeId?: ID; // optional if knight placed at node
  active: boolean;
}

export interface Player {
  id: ID;
  name: string;
  color?: string;
  resources: Record<Resource, number>;
  roads: ID[]; // edge IDs owned
  settlements: ID[]; // node IDs
  cities: ID[]; // node IDs
  knights: ID[]; // knights placed (if using knights)
  victoryPoints: number;
  longestRoadLength: number;
  armySize: number;
}

export interface GameOptions {
  mapType: 'standard' | 'expanded-hex' | 'expanded-delaunay';
  allowRobberOnDesertOnly?: boolean;
  enhancedKnights?: boolean;
  maxPlayers?: number;
  expandedMapSize?: number; // for expanded hex grids
  delaunayTileCount?: number; // for delaunay maps
  seed?: string | number;
}

export interface GameState {
  id: ID;
  players: Player[];
  bank: Record<Resource, number>;
  tiles: Tile[];
  nodes: Node[];
  edges: Edge[];
  knights: Knight[];
  turnOrder: ID[];
  currentPlayerIdx: number;
  phase: 'setup' | 'main' | 'end';
  setupPhase?: {
    round: number; // 0 or 1
    settlementsPlaced: number;
  };
  diceHistory: number[];
  robberTileId: ID | null;
  longestRoadOwner: ID | null;
  largestArmyOwner: ID | null;
  seed?: string | number;
  options: GameOptions;
}

export interface MapData {
  tiles: Tile[];
  nodes: Node[];
  edges: Edge[];
}

export interface MapGeneratorParams {
  seed?: string | number;
  targetTileCount?: number;
  allowedShapes?: TileShape[];
  irregularity?: number; // 0..1 how irregular
  boundingRadius?: number; // visual/layout parameter
  smoothingIters?: number; // Lloyd relaxation iterations
}

export type Action = {
  type: string;
  payload: any;
  playerId: ID;
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

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
  }
} as const;

// Victory points
export const VICTORY_POINTS = {
  settlement: 1,
  city: 2,
  longestRoad: 2,
  largestArmy: 2
} as const;

// Constants
export const MIN_LONGEST_ROAD = 5;
export const MIN_LARGEST_ARMY = 3;
export const ROBBER_DISCARD_THRESHOLD = 7;
