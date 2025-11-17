// Standard Catan board using delaunay-viz map generation

import type { MapData } from '../models/types.js';
import { generateMapFromVisualization } from './mapgenBridge.js';

export function generateStandardCatanBoard(seed?: string | number): MapData {
  // Standard Catan: 19 tiles, 0 erosion rounds
  return generateMapFromVisualization('standard-catan', 19, 0, seed || Date.now());
}
