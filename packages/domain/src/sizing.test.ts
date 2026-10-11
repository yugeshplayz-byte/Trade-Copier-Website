import { describe, expect, it } from 'vitest';
import { SizingRuleError, computeTarget, type SizingRule } from './sizing.ts';

const targets = (nets: number[], rule: SizingRule) =>
  nets.map((n) => {
    const r = computeTarget(n, rule);
    return r.kind === 'TARGET' ? r.target : r.reason;
  });

const HALF: SizingRule = { kind: 'MULTIPLIER', numerator: 1, denominator: 2 };
const DOUBLE: SizingRule = { kind: 'MULTIPLIER', numerator: 2, denominator: 1 };

describe('multiplier sizing (COPIER_ENGINE examples)', () => {
  it('0.5x on cumulative leader 1, 2, 3 gives 0, 1, 1', () => {
    expect(targets([1, 2, 3], HALF)).toEqual([0, 1, 1]);
  });

  it('0.5x as the leader reduces 3 -> 2 -> 1 -> 0 gives 1, 1, 0, 0', () => {
    expect(targets([3, 2, 1, 0], HALF)).toEqual([1, 1, 0, 0]);
  });

  it('applies symmetrically to shorts and never produces negative zero', () => {
    expect(targets([-1, -2, -3], HALF)).toEqual([0, -1, -1]);
    const rounded = computeTarget(-1, HALF);
    expect(rounded.kind === 'TARGET' && Object.is(rounded.target, -0)).toBe(false);
  });

  it('2x on +2 then -1 gives +4 then -2', () => {
    expect(targets([2, -1], DOUBLE)).toEqual([4, -2]);
  });

  it('marks a zero-sized copy as a visible rounding skip, not an error', () => {
    expect(computeTarget(1, HALF)).toEqual({ kind: 'TARGET', target: 0, skippedRounding: true });
    expect(computeTarget(0, HALF)).toEqual({ kind: 'TARGET', target: 0, skippedRounding: false });
  });

  it('uses exact integer arithmetic for awkward ratios', () => {
    // 1/3 of 3 is exactly 1; floating point 3 * (1/3) is 1 too, but 0.1-style ratios are not representable.
    expect(targets([3, 9, 10], { kind: 'MULTIPLIER', numerator: 1, denominator: 3 })).toEqual([1, 3, 3]);
    expect(targets([10], { kind: 'MULTIPLIER', numerator: 7, denominator: 10 })).toEqual([7]);
  });
});

describe('fixed opening-order quantity (Beta rule)', () => {
  const FIXED: SizingRule = { kind: 'FIXED_OPENING_QUANTITY', quantity: 2, openingOrderQuantity: 4 };

  it('Q0=4, K=2 gives 0, 1, 1, 2 as the opening order fills 1..4', () => {
    expect(targets([1, 2, 3, 4], FIXED)).toEqual([0, 1, 1, 2]);
  });

  it('treats scaling in beyond the opening order as unsupported', () => {
    expect(computeTarget(5, FIXED)).toEqual({ kind: 'UNSUPPORTED', reason: 'SCALE_IN_BEYOND_OPENING_ORDER' });
  });
});

describe('rule validation', () => {
  it.each([
    { kind: 'MULTIPLIER', numerator: 0, denominator: 1 },
    { kind: 'MULTIPLIER', numerator: 1, denominator: 0 },
    { kind: 'MULTIPLIER', numerator: 1.5, denominator: 1 },
    { kind: 'FIXED_OPENING_QUANTITY', quantity: 1, openingOrderQuantity: -1 },
  ] as SizingRule[])('rejects %j', (rule) => {
    expect(() => computeTarget(1, rule)).toThrow(SizingRuleError);
  });

  it('rejects non-integer leader positions', () => {
    expect(() => computeTarget(1.5, HALF)).toThrow(RangeError);
  });
});

describe('sizing properties (seeded)', () => {
  it('never exceeds the exact ratio, never flips sign and never rounds up', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 5_000; i++) {
      const leader = Math.floor(rand() * 401) - 200;
      const numerator = 1 + Math.floor(rand() * 10);
      const denominator = 1 + Math.floor(rand() * 10);
      const r = computeTarget(leader, { kind: 'MULTIPLIER', numerator, denominator });
      if (r.kind !== 'TARGET') throw new Error('unexpected');
      expect(Math.abs(r.target) * denominator).toBeLessThanOrEqual(Math.abs(leader) * numerator);
      expect((Math.abs(r.target) + 1) * denominator).toBeGreaterThan(Math.abs(leader) * numerator);
      if (r.target !== 0) expect(Math.sign(r.target)).toBe(Math.sign(leader));
    }
  });
});
