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
  generateMap,
  validateMap,
  validateMapOrThrow
} from '../map/index.js';

export * from '../models/types.js';
export * from '../core/utils.js';
