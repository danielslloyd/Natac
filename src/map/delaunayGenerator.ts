// Delaunay-centroid based irregular polygon map generator

import type { MapData, MapGeneratorParams } from '../models/types.js';
import { generateMapFromVisualization } from './mapgenBridge.js';

export function generateDelaunayMap(params: MapGeneratorParams): MapData {
  const {
    seed,
    targetTileCount = 30
  } = params;

  // Calculate erosion rounds as 4% of tile count
  const erosionRounds = Math.max(1, Math.round(targetTileCount * 0.04));

  // Use new map generation with Lloyd's relaxation and erosion
  return generateMapFromVisualization('delaunay-polygon', targetTileCount, erosionRounds, seed || Date.now());
}
