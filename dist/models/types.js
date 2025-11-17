// Core type definitions for the Catan-like game
export var Resource;
(function (Resource) {
    Resource["ORE"] = "ore";
    Resource["SHEEP"] = "sheep";
    Resource["WOOD"] = "wood";
    Resource["BRICK"] = "brick";
    Resource["WHEAT"] = "wheat";
    Resource["DESERT"] = "desert";
})(Resource || (Resource = {}));
export var TileShape;
(function (TileShape) {
    TileShape[TileShape["PENTAGON"] = 5] = "PENTAGON";
    TileShape[TileShape["HEXAGON"] = 6] = "HEXAGON";
    TileShape[TileShape["HEPTAGON"] = 7] = "HEPTAGON";
})(TileShape || (TileShape = {}));
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
//# sourceMappingURL=types.js.map