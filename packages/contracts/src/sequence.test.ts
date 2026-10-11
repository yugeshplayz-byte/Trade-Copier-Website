import { describe, expect, it } from 'vitest';
import { SequenceTracker } from './sequence.ts';

describe('SequenceTracker', () => {
  it('classifies contiguous, gap, late and duplicate sequences', () => {
    const t = new SequenceTracker();
    expect(t.observe('acct-1', 1).kind).toBe('FIRST');
    expect(t.observe('acct-1', 2).kind).toBe('CONTIGUOUS');
    expect(t.observe('acct-1', 5)).toEqual({ kind: 'GAP', sequence: 5, missing: [3, 4] });
    expect(t.outstandingGaps('acct-1')).toEqual([3, 4]);
    expect(t.observe('acct-1', 4).kind).toBe('LATE');
    expect(t.observe('acct-1', 4).kind).toBe('DUPLICATE');
    expect(t.observe('acct-1', 2).kind).toBe('DUPLICATE');
    expect(t.outstandingGaps('acct-1')).toEqual([3]);
    expect(t.observe('acct-1', 3).kind).toBe('LATE');
    expect(t.outstandingGaps('acct-1')).toEqual([]);
  });

  it('keeps scopes independent', () => {
    const t = new SequenceTracker();
    t.observe('acct-1', 10);
    expect(t.observe('acct-2', 10).kind).toBe('FIRST');
    expect(t.observe('acct-1', 11).kind).toBe('CONTIGUOUS');
  });

  it('rejects invalid sequence values', () => {
    const t = new SequenceTracker();
    expect(() => t.observe('s', -1)).toThrow(RangeError);
    expect(() => t.observe('s', 1.5)).toThrow(RangeError);
  });
});
