export type ID = string;
export declare enum Resource {
    ORE = "ore",
    SHEEP = "sheep",
    WOOD = "wood",
    BRICK = "brick",
    WHEAT = "wheat",
    DESERT = "desert"
}
export declare enum TileShape {
    PENTAGON = 5,
    HEXAGON = 6,
    HEPTAGON = 7
}
export interface Tile {
    id: ID;
    shape: TileShape;
    polygonPoints?: [number, number][];
    resource: Resource;
    diceNumber: number | null;
    edges: ID[];
    nodes: ID[];
    robberPresent?: boolean;
}
export interface Node {
    id: ID;
    location?: [number, number];
    tiles: ID[];
    occupant?: {
        playerId: ID;
        type: 'settlement' | 'city';
    } | null;
}
export interface Edge {
    id: ID;
    nodeA: ID;
    nodeB: ID;
    tileLeft?: ID | null;
    tileRight?: ID | null;
    roadOwner?: ID | null;
}
export interface Knight {
    id: ID;
    ownerId: ID;
    nodeId?: ID;
    active: boolean;
}
export interface Player {
    id: ID;
    name: string;
    color?: string;
    resources: Record<Resource, number>;
    roads: ID[];
    settlements: ID[];
    cities: ID[];
    knights: ID[];
    victoryPoints: number;
    longestRoadLength: number;
    armySize: number;
}
export interface GameOptions {
    mapType: 'standard' | 'expanded-hex' | 'expanded-delaunay';
    allowRobberOnDesertOnly?: boolean;
    enhancedKnights?: boolean;
    maxPlayers?: number;
    expandedMapSize?: number;
    delaunayTileCount?: number;
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
        round: number;
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
    irregularity?: number;
    boundingRadius?: number;
    smoothingIters?: number;
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
export declare const BUILDING_COSTS: {
    readonly road: {
        readonly brick: 1;
        readonly wood: 1;
    };
    readonly settlement: {
        readonly brick: 1;
        readonly wood: 1;
        readonly sheep: 1;
        readonly wheat: 1;
    };
    readonly city: {
        readonly wheat: 2;
        readonly ore: 3;
    };
    readonly developmentCard: {
        readonly sheep: 1;
        readonly wheat: 1;
        readonly ore: 1;
    };
};
export declare const VICTORY_POINTS: {
    readonly settlement: 1;
    readonly city: 2;
    readonly longestRoad: 2;
    readonly largestArmy: 2;
};
export declare const MIN_LONGEST_ROAD = 5;
export declare const MIN_LARGEST_ARMY = 3;
export declare const ROBBER_DISCARD_THRESHOLD = 7;
//# sourceMappingURL=types.d.ts.map