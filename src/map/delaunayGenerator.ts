// Delaunay-centroid based irregular polygon map generator

import type { MapData, MapGeneratorParams } from '../models/types.js';
import { generateMapFromVisualization } from './mapgenBridge.js';

export function generateDelaunayMap(params: MapGeneratorParams): MapData {
  const {
    seed,
    targetTileCount = 30
  } = params;

  // Use new map generation with Lloyd's relaxation and erosion (3 rounds for organic coastlines)
  return generateMapFromVisualization('delaunay-polygon', targetTileCount, 3, seed || Date.now());
}
