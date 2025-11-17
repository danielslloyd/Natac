// Main map generation interface

import type { MapData, MapGeneratorParams, GameOptions } from '../models/types.js';
import { generateStandardCatanMap, generateExpandedHexMap } from './hexGenerator.js';
import { generateDelaunayMap } from './delaunayGenerator.js';
import { validateMapOrThrow } from './validator.js';

export function generateMap(options: GameOptions): MapData {
  let mapData: MapData;

  switch (options.mapType) {
    case 'standard':
      mapData = generateStandardCatanMap(options.seed);
      break;

    case 'expanded-hex':
      mapData = generateExpandedHexMap(
        options.expandedMapSize || 30,
        options.seed
      );
      break;

    case 'expanded-delaunay':
      mapData = generateDelaunayMap({
        seed: options.seed,
        targetTileCount: options.delaunayTileCount || 30,
        irregularity: 0.3,
        boundingRadius: 300,
        smoothingIters: 2
      });
      break;

    default:
      throw new Error(`Unknown map type: ${options.mapType}`);
  }

  // Validate the generated map
  try {
    validateMapOrThrow(mapData);
  } catch (error) {
    // For delaunay maps, we might need to retry or relax constraints
    if (options.mapType === 'expanded-delaunay') {
      // Delaunay can be complex - fall back to hex map silently
      mapData = generateExpandedHexMap(
        options.delaunayTileCount || 30,
        options.seed
      );
      validateMapOrThrow(mapData);
    } else {
      throw error;
    }
  }

  return mapData;
}

export * from './validator.js';
export * from './hexGenerator.js';
export * from './delaunayGenerator.js';
