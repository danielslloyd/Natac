// Standard Catan board using delaunay-viz map generation
import { generateMapFromVisualization } from './mapgenBridge.js';
export function generateStandardCatanBoard(seed) {
    // Standard Catan: 19 tiles, 0 erosion rounds
    return generateMapFromVisualization('standard-catan', 19, 0, seed || Date.now());
}
//# sourceMappingURL=standardBoard.js.map