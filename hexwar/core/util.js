// hexwar/core/util.js
// Small self-contained utilities for the hexwar engine.
// (Deliberately independent from src/core/utils.js so the hexwar/ folder can be
// lifted out of this repo wholesale.)

export class SeededRandom {
  constructor(seed = Date.now()) {
    this.seed = typeof seed === 'string' ? hashString(seed) : (seed >>> 0) || 1;
  }
  next() {
    // LCG, same constants as Numerical Recipes
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
  nextInt(min, max) { // inclusive
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  pick(array) {
    return array[this.nextInt(0, array.length - 1)];
  }
  shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function dist(a, b) {
  return Math.sqrt(dist2(a, b));
}

/**
 * Smooth scalar field built from a handful of seeded gaussian blobs.
 * Returns f(x, y) -> value roughly in [0, 1] over the given radius.
 */
export function makeBlobField(rng, { blobs = 6, radius = 300, sharpness = 1 } = {}) {
  const centers = [];
  for (let i = 0; i < blobs; i++) {
    centers.push({
      x: rng.range(-radius, radius),
      y: rng.range(-radius, radius),
      sigma: rng.range(radius * 0.15, radius * 0.45),
      amp: rng.range(0.4, 1.0) * (rng.next() < 0.25 ? -1 : 1)
    });
  }
  return (x, y) => {
    let v = 0;
    for (const c of centers) {
      const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
      v += c.amp * Math.exp(-d2 / (2 * c.sigma * c.sigma));
    }
    // squash to [0,1]
    return clamp(0.5 + 0.5 * Math.tanh(v * sharpness), 0, 1);
  };
}
