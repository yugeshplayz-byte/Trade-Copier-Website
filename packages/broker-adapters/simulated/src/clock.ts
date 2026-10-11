/** Manually advanced clock: simulated time moves only when told to. */
export class VirtualClock {
  private ms: number;

  constructor(startIso: string) {
    const ms = Date.parse(startIso);
    if (Number.isNaN(ms)) throw new RangeError('startIso must be an ISO timestamp');
    this.ms = ms;
  }

  nowMs(): number {
    return this.ms;
  }

  iso(): string {
    return new Date(this.ms).toISOString();
  }

  advance(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError('advance requires a non-negative integer');
    this.ms += ms;
  }
}

/** Small seeded PRNG (mulberry32). Same seed, same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
