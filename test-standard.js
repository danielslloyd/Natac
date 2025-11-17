// Quick test of standard board
import { generateStandardCatanBoard } from './dist/map/standardBoard.js';
import { validateMap } from './dist/map/validator.js';

console.log('Testing standard Catan board...\n');

const board = generateStandardCatanBoard(12345);

console.log(`Tiles: ${board.tiles.length}`);
console.log(`Nodes: ${board.nodes.length}`);
console.log(`Edges: ${board.edges.length}`);

// Check first tile's nodes
const firstTile = board.tiles[0];
console.log(`\nFirst tile ${firstTile.id}:`);
console.log(`  Nodes: ${firstTile.nodes.join(', ')}`);
console.log(`  Edges: ${firstTile.edges.join(', ')}`);

// Check if nodes reference the tile
firstTile.nodes.forEach(nodeId => {
  const node = board.nodes.find(n => n.id === nodeId);
  if (node) {
    console.log(`  Node ${nodeId} touches tiles: ${node.tiles.join(', ')}`);
  }
});

// Check how many nodes each tile shares
console.log('\nShared nodes between first two tiles:');
const secondTile = board.tiles[1];
const sharedNodes = firstTile.nodes.filter(n => secondTile.nodes.includes(n));
console.log(`Tiles ${firstTile.id} and ${secondTile.id} share ${sharedNodes.length} nodes`);

const validation = validateMap(board);
console.log(`\nValidation: ${validation.valid ? '✓ PASSED' : '✗ FAILED'}`);

if (!validation.valid) {
  console.log('\nErrors:');
  validation.errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
  if (validation.errors.length > 10) {
    console.log(`  ... and ${validation.errors.length - 10} more errors`);
  }
}
