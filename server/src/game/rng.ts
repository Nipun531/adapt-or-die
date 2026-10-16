/**
 * Deterministic, serialisable random number generator.
 * mulberry32: the whole generator state is one uint32, so an in-progress round can be saved to the
 * database and resumed later with the exact same future rolls (reproducible + auditable combat).
 */

export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

/** FNV-1a 32-bit hash of a string → uint32 seed. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive a child seed from a parent seed and a label (e.g. "round:3"), so seeds form a reproducible tree. */
export function deriveSeed(parent: string | number, label: string): number {
  return hashSeed(`${parent}::${label}`);
}

/** Random seed for manual runs (recorded so the run can still be audited/replayed). */
export function freshSeed(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
