import { describe, expect, it } from 'vitest';
import { planFollower, replanUnsent, type CopyPlan, type FollowerState, type PlanLimits } from './planner.ts';
import { computeTarget } from './sizing.ts';

const LIMITS: PlanLimits = { maxAbsPosition: 10, maxOrderQuantity: 10, entriesAllowed: true };
const state = (over: Partial<FollowerState> = {}): FollowerState => ({
  actual: 0,
  working: 0,
  reserved: 0,
  unknownOutcomes: 0,
  stateFresh: true,
  ...over,
});
const target = (leaderNet: number, numerator: number, denominator = 1) => {
  const r = computeTarget(leaderNet, { kind: 'MULTIPLIER', numerator, denominator });
  if (r.kind !== 'TARGET') throw new Error('unexpected');
  return r.target;
};

describe('planFollower: spec scenarios', () => {
  it('scenario 3: buying 3 at 0.5x in partial executions ends with follower 1, and the exit leaves 0', () => {
    let actual = 0;
    const orders: CopyPlan[] = [];
    for (const leaderNet of [1, 2, 3, 0]) {
      const plan = planFollower(target(leaderNet, 1, 2), state({ actual }), LIMITS);
      orders.push(plan);
      if (plan.kind === 'ORDER') actual += plan.side === 'BUY' ? plan.quantity : -plan.quantity;
    }
    expect(orders.map((p) => p.kind)).toEqual(['NO_ACTION', 'ORDER', 'NO_ACTION', 'ORDER']);
    expect(actual).toBe(0);
    expect(orders[1]).toEqual({ kind: 'ORDER', side: 'BUY', quantity: 1, purpose: 'INCREASE' });
    expect(orders[3]).toEqual({ kind: 'ORDER', side: 'SELL', quantity: 1, purpose: 'REDUCE' });
  });

  it('scenario 8: leader +2 -> -1 at 2x closes +4 first, then shorts 2 only after flat and revalidation', () => {
    expect(planFollower(target(-1, 2), state({ actual: 4 }), LIMITS)).toEqual({
      kind: 'CLOSE_THEN_REVALIDATE',
      side: 'SELL',
      quantity: 4,
      deferredTarget: -2,
    });
    // Broker confirms flat; the new short is planned fresh.
    expect(planFollower(-2, state({ actual: 0 }), LIMITS)).toEqual({ kind: 'ORDER', side: 'SELL', quantity: 2, purpose: 'INCREASE' });
    // A risk failure at that point leaves the follower flat.
    expect(planFollower(-2, state({ actual: 0 }), { ...LIMITS, entriesAllowed: false })).toEqual({
      kind: 'BLOCKED',
      reason: 'ENTRIES_HALTED',
    });
  });

  it('scenario 17: a leader round trip completing before dispatch supersedes the unsent entry', () => {
    // Leader bought 2 at 1x: a BUY 2 command was prepared but not sent. Then the leader exited.
    const result = replanUnsent(0, state({ reserved: 2 }), LIMITS, { side: 'BUY', quantity: 2 });
    expect(result).toEqual({ supersede: true, plan: { kind: 'NO_ACTION', reason: 'IN_SYNC' } });
  });

  it('keeps an unsent command when it still matches the fresh plan', () => {
    expect(replanUnsent(2, state({ reserved: 2 }), LIMITS, { side: 'BUY', quantity: 2 })).toEqual({
      supersede: false,
      plan: { kind: 'NO_ACTION', reason: 'IN_SYNC' },
    });
    // The target grew while the command was unsent: replace it with the full current delta, never stack.
    expect(replanUnsent(3, state({ reserved: 2 }), LIMITS, { side: 'BUY', quantity: 2 })).toEqual({
      supersede: true,
      plan: { kind: 'ORDER', side: 'BUY', quantity: 3, purpose: 'INCREASE' },
    });
  });
});

describe('planFollower: RISK_ENGINE acceptance cases', () => {
  const capped: PlanLimits = { maxAbsPosition: 5, maxOrderQuantity: 5, entriesAllowed: true };

  it('cap 5, long 3, working buy 1, new buy 2: rejected because projected exposure is 6', () => {
    expect(planFollower(6, state({ actual: 3, working: 1 }), capped)).toEqual({ kind: 'BLOCKED', reason: 'CAP_EXCEEDED' });
  });

  it('cap 5, long 6, sell-to-close 6: the reduction is allowed despite the existing breach', () => {
    expect(planFollower(0, state({ actual: 6 }), capped)).toEqual({ kind: 'ORDER', side: 'SELL', quantity: 6, purpose: 'REDUCE' });
  });

  it('unknown buy after a timeout blocks everything: no further buy and no blind flatten', () => {
    for (const t of [0, 2, 4, -2]) {
      expect(planFollower(t, state({ unknownOutcomes: 1 }), capped)).toEqual({ kind: 'BLOCKED', reason: 'UNKNOWN_OUTCOME' });
    }
  });

  it('halted entries never block an exit', () => {
    expect(planFollower(1, state({ actual: 3 }), { ...capped, entriesAllowed: false })).toEqual({
      kind: 'ORDER',
      side: 'SELL',
      quantity: 2,
      purpose: 'REDUCE',
    });
  });

  it('stale state blocks planning; opposing working orders must be resolved first', () => {
    expect(planFollower(2, state({ stateFresh: false }), capped)).toEqual({ kind: 'BLOCKED', reason: 'STALE_STATE' });
    expect(planFollower(0, state({ working: 2 }), capped)).toEqual({ kind: 'BLOCKED', reason: 'OPPOSING_WORKING_ORDERS' });
  });

  it('rejects an oversized single order rather than splitting it silently', () => {
    expect(planFollower(5, state(), { ...capped, maxOrderQuantity: 2 })).toEqual({ kind: 'BLOCKED', reason: 'ORDER_SIZE_EXCEEDED' });
  });
});

describe('planFollower: properties (seeded)', () => {
  it('never reverses exposure in one order, never exceeds caps on increases, and converges', () => {
    let seed = 987654;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let i = 0; i < 10_000; i++) {
      const limits: PlanLimits = { maxAbsPosition: int(1, 8), maxOrderQuantity: int(1, 8), entriesAllowed: rand() > 0.2 };
      const s = state({ actual: int(-8, 8), working: rand() > 0.7 ? int(-3, 3) : 0, unknownOutcomes: rand() > 0.9 ? 1 : 0, stateFresh: rand() > 0.05 });
      const t = int(-8, 8);
      const plan = planFollower(t, s, limits);
      const exposure = s.actual + s.working + s.reserved;

      if (s.unknownOutcomes > 0) expect(plan).toEqual({ kind: 'BLOCKED', reason: 'UNKNOWN_OUTCOME' });
      if (plan.kind === 'ORDER') {
        const after = exposure + (plan.side === 'BUY' ? plan.quantity : -plan.quantity);
        expect(after).toBe(t); // converges exactly to target
        if (exposure !== 0 && after !== 0) expect(Math.sign(after)).toBe(Math.sign(exposure)); // no single-order reversal
        if (plan.purpose === 'INCREASE') {
          expect(Math.abs(after)).toBeLessThanOrEqual(limits.maxAbsPosition);
          expect(plan.quantity).toBeLessThanOrEqual(limits.maxOrderQuantity);
          expect(limits.entriesAllowed).toBe(true);
        }
      }
      if (plan.kind === 'CLOSE_THEN_REVALIDATE') {
        expect(exposure + (plan.side === 'BUY' ? plan.quantity : -plan.quantity)).toBe(0);
      }
    }
  });
});
