import type { Edge, MapData, ValidationResult } from '../models/types.js';
export declare function validateMap(mapData: MapData): ValidationResult;
export declare function validateMapOrThrow(mapData: MapData): void;
export declare function areNodesAdjacent(nodeA: string, nodeB: string, edges: Edge[]): boolean;
export declare function getAdjacentNodes(nodeId: string, edges: Edge[]): string[];
export declare function getNodeEdges(nodeId: string, edges: Edge[]): Edge[];
export declare function findEdge(nodeA: string, nodeB: string, edges: Edge[]): Edge | undefined;
//# sourceMappingURL=validator.d.ts.map