export declare class SeededRandom {
    private seed;
    constructor(seed?: string | number);
    private hashCode;
    next(): number;
    nextInt(min: number, max: number): number;
    shuffle<T>(array: T[]): T[];
}
export declare function generateId(prefix?: string): string;
export declare function distance(p1: [number, number], p2: [number, number]): number;
export declare function pointsEqual(p1: [number, number], p2: [number, number], epsilon?: number): boolean;
export declare function angleBetween(center: [number, number], point: [number, number]): number;
export declare function sortPointsByAngle(points: [number, number][], center: [number, number]): [number, number][];
export declare function centroid(points: [number, number][]): [number, number];
export declare function polygonArea(points: [number, number][]): number;
export declare function ensureCounterClockwise(points: [number, number][]): [number, number][];
export interface HexCoord {
    q: number;
    r: number;
}
export declare function hexToPixel(hex: HexCoord, size: number): [number, number];
export declare function hexCorners(center: [number, number], size: number): [number, number][];
export declare function hexNeighbors(hex: HexCoord): HexCoord[];
export declare function hexDistance(a: HexCoord, b: HexCoord): number;
export declare function hexRing(center: HexCoord, radius: number): HexCoord[];
export declare function hexSpiral(center: HexCoord, radius: number): HexCoord[];
//# sourceMappingURL=utils.d.ts.map