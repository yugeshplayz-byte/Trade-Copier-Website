/**
 * Classifies provider sequence numbers within one documented scope so that the
 * inbox can detect duplicates, gaps and reordering (REALTIME.md, RECONCILIATION.md).
 * A sequence is ordered only inside its scope; trackers are never shared across scopes.
 */
export type SequenceClassification =
  | { readonly kind: 'FIRST'; readonly sequence: number }
  | { readonly kind: 'CONTIGUOUS'; readonly sequence: number }
  | { readonly kind: 'GAP'; readonly sequence: number; readonly missing: readonly number[] }
  | { readonly kind: 'DUPLICATE'; readonly sequence: number }
  | { readonly kind: 'LATE'; readonly sequence: number };

/** Upper bound on remembered missing sequences per scope. */
const MAX_TRACKED_MISSING = 10_000;

export class SequenceTracker {
  private readonly highWater = new Map<string, number>();
  private readonly missing = new Map<string, Set<number>>();

  /**
   * Records `sequence` for `scope` and classifies it.
   * - GAP: one or more earlier sequences were skipped; they are remembered as missing.
   * - LATE: a previously missing sequence arrived out of order (it fills the gap).
   * - DUPLICATE: already seen; must have no additional economic effect.
   */
  observe(scope: string, sequence: number): SequenceClassification {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new RangeError('sequence must be a non-negative safe integer');
    }
    const high = this.highWater.get(scope);
    const missing = this.missing.get(scope) ?? new Set<number>();
    this.missing.set(scope, missing);

    if (high === undefined) {
      this.highWater.set(scope, sequence);
      return { kind: 'FIRST', sequence };
    }
    if (sequence === high + 1) {
      this.highWater.set(scope, sequence);
      return { kind: 'CONTIGUOUS', sequence };
    }
    if (sequence > high + 1) {
      const skipped: number[] = [];
      for (let s = high + 1; s < sequence && missing.size < MAX_TRACKED_MISSING; s++) {
        missing.add(s);
        skipped.push(s);
      }
      this.highWater.set(scope, sequence);
      return { kind: 'GAP', sequence, missing: skipped };
    }
    if (missing.delete(sequence)) {
      return { kind: 'LATE', sequence };
    }
    return { kind: 'DUPLICATE', sequence };
  }

  /** Sequences still missing in `scope`; non-empty means state for that scope is uncertain. */
  outstandingGaps(scope: string): number[] {
    return [...(this.missing.get(scope) ?? [])].sort((a, b) => a - b);
  }
}
