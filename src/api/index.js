// Public API for the game

export {
  createGame,
  applyAction,
  validateAction,
  rollDice,
  collectResources,
  getCurrentPlayer,
  getLegalBuildLocations
} from '../core/game.js';

export {
  moveRobber,
  playKnight,
  handleRobberActivation,
  getPlayersOnTile
} from '../core/robber.js';

export {
  purchaseMilitaryKnight,
  placeWagon,
  repositionWagon,
  buildFleet,
  moveMilitaryKnight,
  moveFleet,
  loadKnightOntoFleet,
  unloadKnightFromFleet,
  updateKnightSupplyStatus,
  updateCaptureProgress,
  collectMaintenanceCosts,
  resetMovementFlags
} from '../core/military.js';

export {
  validateCreateTradeProposal,
  createTradeProposal,
  validateAcceptTradeProposal,
  acceptTradeProposal,
  declineTradeProposal,
  cancelTradeProposal,
  validateExecuteTrade,
  executeTrade,
  createCounterOffer
} from '../core/trade.js';

export {
  shouldAcceptTrade,
  generateAITradeProposal,
  generateAICounterOffer,
  getAIBuildingPriority
} from '../core/ai.js';

export {
  generateMap,
  validateMap,
  validateMapOrThrow
} from '../map/index.js';

export {
  Resource,
  TileShape,
  BUILDING_COSTS,
  MAINTENANCE_COSTS,
  VICTORY_POINTS,
  MIN_LONGEST_ROAD,
  MIN_LARGEST_ARMY,
  ROBBER_DISCARD_THRESHOLD
} from '../models/types.js';

export {
  generateId,
  SeededRandom,
  distance,
  pointsEqual,
  angleBetween,
  sortPointsByAngle,
  centroid,
  polygonArea,
  ensureCounterClockwise,
  hexToPixel,
  hexCorners,
  hexNeighbors,
  hexDistance,
  hexRing,
  hexSpiral
} from '../core/utils.js';
