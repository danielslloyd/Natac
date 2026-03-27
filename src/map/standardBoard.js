// Standard Catan board using delaunay-viz map generation

import { generateMapFromVisualization } from './mapgenBridge.js';

export function generateStandardCatanBoard(seed) {
  return generateMapFromVisualization('standard-catan', 19, 0, seed || Date.now());
}
