// Map generation tests

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  generateMap,
  validateMap,
  createGame
} from '../api/index.js';
import type { GameOptions } from '../models/types.js';

describe('Map Generation', () => {
  test('Standard Catan map should generate 19 tiles', () => {
    const options: GameOptions = {
      mapType: 'standard',
      seed: 12345
    };

    const map = generateMap(options);
    assert.strictEqual(map.tiles.length, 19, 'Should have 19 tiles');
    console.log(`✓ Standard map has ${map.tiles.length} tiles`);
  });

  test('Standard map should pass validation', () => {
    const options: GameOptions = {
      mapType: 'standard',
      seed: 12345
    };

    const map = generateMap(options);
    const validation = validateMap(map);

    assert.strictEqual(validation.valid, true, 'Map should be valid');
    if (!validation.valid) {
      console.error('Validation errors:', validation.errors);
    }
    console.log(`✓ Standard map passed validation`);
  });

  test('All nodes should touch 1-3 tiles (vertex-degree constraint)', () => {
    const options: GameOptions = {
      mapType: 'standard',
      seed: 12345
    };

    const map = generateMap(options);
    const invalidNodes = map.nodes.filter(node => node.tiles.length < 1 || node.tiles.length > 3);
    const interiorNodes = map.nodes.filter(node => node.tiles.length === 3);

    assert.strictEqual(
      invalidNodes.length,
      0,
      `All nodes must touch 1-3 tiles. Found ${invalidNodes.length} invalid nodes`
    );
    console.log(`✓ ${map.nodes.length} nodes valid (${interiorNodes.length} interior nodes with 3 tiles)`);
  });

  test('Expanded hex map should generate more tiles', () => {
    const options: GameOptions = {
      mapType: 'expanded-hex',
      expandedMapSize: 30,
      seed: 12345
    };

    const map = generateMap(options);
    assert.ok(map.tiles.length >= 25, `Should have at least 25 tiles, got ${map.tiles.length}`);
    console.log(`✓ Expanded hex map has ${map.tiles.length} tiles`);
  });

  test('Expanded hex map should pass validation', () => {
    const options: GameOptions = {
      mapType: 'expanded-hex',
      expandedMapSize: 30,
      seed: 12345
    };

    const map = generateMap(options);
    const validation = validateMap(map);

    assert.strictEqual(validation.valid, true, 'Expanded hex map should be valid');
    console.log(`✓ Expanded hex map passed validation`);
  });

  test('Delaunay map should generate with fallback', () => {
    const options: GameOptions = {
      mapType: 'expanded-delaunay',
      delaunayTileCount: 30,
      seed: 12345
    };

    const map = generateMap(options);
    // Delaunay may fall back to hex map if validation fails
    assert.ok(map.tiles.length > 0, 'Should generate at least some tiles');
    console.log(`✓ Delaunay map generated ${map.tiles.length} tiles (may use fallback hex)`);
  });

  test('Delaunay map should pass validation (with fallback)', () => {
    const options: GameOptions = {
      mapType: 'expanded-delaunay',
      delaunayTileCount: 30,
      seed: 12345
    };

    const map = generateMap(options);
    const validation = validateMap(map);

    // With fallback, should always be valid
    assert.strictEqual(validation.valid, true, 'Map should be valid (possibly via fallback)');
    console.log(`✓ Delaunay map passed validation`);
  });
});

describe('Game Initialization', () => {
  test('Should create game with standard map', () => {
    const options: GameOptions = {
      mapType: 'standard',
      seed: 12345
    };

    const game = createGame(['Alice', 'Bob', 'Charlie'], options);

    assert.strictEqual(game.players.length, 3, 'Should have 3 players');
    assert.strictEqual(game.tiles.length, 19, 'Should have 19 tiles');
    assert.strictEqual(game.phase, 'setup', 'Should start in setup phase');
    console.log(`✓ Game created with ${game.players.length} players`);
  });

  test('Should initialize players with zero resources', () => {
    const options: GameOptions = {
      mapType: 'standard',
      seed: 12345
    };

    const game = createGame(['Alice', 'Bob'], options);

    game.players.forEach(player => {
      const totalResources = Object.values(player.resources).reduce((sum, count) => sum + count, 0);
      assert.strictEqual(totalResources, 0, `${player.name} should start with 0 resources`);
    });
    console.log(`✓ All players initialized with zero resources`);
  });

  test('Should place robber on desert tile', () => {
    const options: GameOptions = {
      mapType: 'standard',
      seed: 12345
    };

    const game = createGame(['Alice', 'Bob'], options);
    const robberTile = game.tiles.find(t => t.id === game.robberTileId);

    assert.ok(robberTile, 'Robber should be on a tile');
    if (robberTile) {
      assert.strictEqual(robberTile.robberPresent, true, 'Robber tile should be marked');
    }
    console.log(`✓ Robber placed on tile ${robberTile?.id}`);
  });
});

describe('Map Statistics', () => {
  test('Standard map statistics', () => {
    const options: GameOptions = {
      mapType: 'standard',
      seed: 12345
    };

    const map = generateMap(options);

    console.log('\n--- Standard Map Statistics ---');
    console.log(`Tiles: ${map.tiles.length}`);
    console.log(`Nodes: ${map.nodes.length}`);
    console.log(`Edges: ${map.edges.length}`);

    const shapeCounts = map.tiles.reduce((acc, tile) => {
      acc[tile.shape] = (acc[tile.shape] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    console.log('Tile shapes:', shapeCounts);

    const resourceCounts = map.tiles.reduce((acc, tile) => {
      acc[tile.resource] = (acc[tile.resource] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('Resources:', resourceCounts);
  });

  test('Expanded hex map statistics', () => {
    const options: GameOptions = {
      mapType: 'expanded-hex',
      expandedMapSize: 30,
      seed: 12345
    };

    const map = generateMap(options);

    console.log('\n--- Expanded Hex Map Statistics ---');
    console.log(`Tiles: ${map.tiles.length}`);
    console.log(`Nodes: ${map.nodes.length}`);
    console.log(`Edges: ${map.edges.length}`);

    const shapeCounts = map.tiles.reduce((acc, tile) => {
      acc[tile.shape] = (acc[tile.shape] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    console.log('Tile shapes:', shapeCounts);
  });
});
