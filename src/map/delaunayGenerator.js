// Delaunay-centroid based irregular polygon map generator

import { generateMapFromVisualization } from './mapgenBridge.js';

export function generateDelaunayMap(params) {
  const {
    seed,
    targetTileCount = 30
  } = params;

  // Calculate erosion rounds as 4% of tile count
  const erosionRounds = Math.max(1, Math.round(targetTileCount * 0.04));

  return generateMapFromVisualization('delaunay-polygon', targetTileCount, erosionRounds, seed || Date.now());
}
