// hexwar/games/index.js
// Variant registry + the one-call entry point for creating a game.

import { Game } from '../core/engine.js';
import { stretchRuleset } from './stretch.js';
import { hexIsoRuleset } from './hexiso.js';
import { civRuleset } from './civ.js';
import { riftRuleset } from './rift.js';
import { surgeRuleset } from './surge.js';

export const RULESETS = {
  stretch: stretchRuleset,
  hexiso: hexIsoRuleset,
  civ: civRuleset,
  rift: riftRuleset,
  surge: surgeRuleset
};

/**
 * createGame({ variant, seed, players, options }) -> Game
 * options are merged over the variant's defaults (e.g. { mapStyle: 'hexish' }
 * for civ, { rangeMode: 'los' } for hexiso).
 */
export function createGame({ variant = 'civ', seed = 1, players = 2, options = {} } = {}) {
  const ruleset = RULESETS[variant];
  if (!ruleset) {
    throw new Error(`unknown variant "${variant}" (have: ${Object.keys(RULESETS).join(', ')})`);
  }
  return new Game({ ruleset, seed, players, options });
}
