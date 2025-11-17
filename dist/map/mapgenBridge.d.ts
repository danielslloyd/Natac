import type { MapData } from '../models/types.js';
declare global {
    interface Window {
        generateMapData: (mapType: 'standard-catan' | 'expanded-hex' | 'delaunay-polygon', numTiles: number, erosionRounds: number) => {
            redCircles: {
                land: Array<{
                    id: number;
                    position: [number, number];
                }>;
                water: Array<{
                    id: number;
                    position: [number, number];
                }>;
            };
            blueNodes: Array<{
                id: number;
                position: [number, number];
            }>;
            greenEdges: Array<{
                from: number;
                to: number;
            }>;
            blackEdges: Array<{
                from: number;
                to: number;
            }>;
            metadata: {
                mapType: string;
                totalLandTiles: number;
                totalWaterTiles: number;
                totalBlueNodes: number;
                totalGreenEdges: number;
                totalBlackEdges: number;
            };
        };
    }
}
export declare function generateMapFromVisualization(mapType: 'standard-catan' | 'expanded-hex' | 'delaunay-polygon', numTiles: number, erosionRounds: number, seed: string | number): MapData;
//# sourceMappingURL=mapgenBridge.d.ts.map