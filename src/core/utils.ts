// Utility functions for game logic

export class SeededRandom {
  private seed: number;

  constructor(seed: string | number = Date.now()) {
    this.seed = typeof seed === 'string' ? this.hashCode(seed) : seed;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  // Simple LCG (Linear Congruential Generator)
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

export function generateId(prefix: string = 'id'): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

export function distance(p1: [number, number], p2: [number, number]): number {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function pointsEqual(
  p1: [number, number],
  p2: [number, number],
  epsilon: number = 0.0001
): boolean {
  return distance(p1, p2) < epsilon;
}

export function angleBetween(center: [number, number], point: [number, number]): number {
  return Math.atan2(point[1] - center[1], point[0] - center[0]);
}

export function sortPointsByAngle(
  points: [number, number][],
  center: [number, number]
): [number, number][] {
  return [...points].sort((a, b) => {
    return angleBetween(center, a) - angleBetween(center, b);
  });
}

export function centroid(points: [number, number][]): [number, number] {
  const sum = points.reduce(
    (acc, p) => [acc[0] + p[0], acc[1] + p[1]] as [number, number],
    [0, 0] as [number, number]
  );
  return [sum[0] / points.length, sum[1] / points.length];
}

export function polygonArea(points: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

export function ensureCounterClockwise(points: [number, number][]): [number, number][] {
  // Calculate signed area
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  // If area is negative, points are clockwise
  return area < 0 ? [...points].reverse() : points;
}

// Axial hex coordinates
export interface HexCoord {
  q: number;
  r: number;
}

export function hexToPixel(hex: HexCoord, size: number): [number, number] {
  const x = size * (3 / 2 * hex.q);
  const y = size * (Math.sqrt(3) / 2 * hex.q + Math.sqrt(3) * hex.r);
  return [x, y];
}

export function hexCorners(center: [number, number], size: number): [number, number][] {
  const corners: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // Start from pointy-top orientation
    corners.push([
      center[0] + size * Math.cos(angle),
      center[1] + size * Math.sin(angle)
    ]);
  }
  return corners;
}

export function hexNeighbors(hex: HexCoord): HexCoord[] {
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];
  return directions.map(d => ({ q: hex.q + d.q, r: hex.r + d.r }));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius === 0) return [center];

  const results: HexCoord[] = [];
  let hex = { q: center.q + radius, r: center.r - radius };

  const directions = [
    { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
    { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 }
  ];

  for (const dir of directions) {
    for (let i = 0; i < radius; i++) {
      results.push({ ...hex });
      hex = { q: hex.q + dir.q, r: hex.r + dir.r };
    }
  }

  return results;
}

export function hexSpiral(center: HexCoord, radius: number): HexCoord[] {
  const results: HexCoord[] = [center];
  for (let r = 1; r <= radius; r++) {
    results.push(...hexRing(center, r));
  }
  return results;
}
