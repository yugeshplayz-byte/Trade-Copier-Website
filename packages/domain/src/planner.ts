import type { Side } from '@tradecopier/contracts';

/**
 * Follower order planning for EXECUTION mode (COPIER_ENGINE.md, RISK_ENGINE.md).
 *
 * Given the follower's target T and its current state, the normal delta is
 * D = T - A - W - R, where A is the fresh actual position, W the signed unfilled
 * quantity of acknowledged copier orders, and R the signed quantity of prepared,
 * unsent commands. The planner is pure: it proposes at most one step and never
 * performs I/O. Risk is rechecked again at dispatch.
 */

export interface FollowerState {
  /** Fresh broker-reported signed position (A). */
  readonly actual: number;
  /** Signed unfilled quantity of acknowledged copier orders (W). */
  readonly working: number;
  /** Signed quantity of prepared, unsent commands (R). */
  readonly reserved: number;
  /** Commands whose broker outcome is unknown. Any value above zero blocks planning. */
  readonly unknownOutcomes: number;
  /** Snapshot is fresh, complete and consistent with the event stream. */
  readonly stateFresh: boolean;
}

export interface PlanLimits {
  /** Hard cap on absolute position for risk-increasing orders. */
  readonly maxAbsPosition: number;
  /** Hard cap on a single risk-increasing order's quantity. */
  readonly maxOrderQuantity: number;
  /** False when paused, halted, latched or billing-restricted. Reductions remain allowed. */
  readonly entriesAllowed: boolean;
}

export type BlockReason =
  | 'UNKNOWN_OUTCOME'
  | 'STALE_STATE'
  | 'OPPOSING_WORKING_ORDERS'
  | 'ENTRIES_HALTED'
  | 'CAP_EXCEEDED'
  | 'ORDER_SIZE_EXCEEDED';

export type CopyPlan =
  | { readonly kind: 'NO_ACTION'; readonly reason: 'IN_SYNC' }
  | {
      readonly kind: 'ORDER';
      readonly side: Side;
      readonly quantity: number;
      readonly purpose: 'INCREASE' | 'REDUCE';
    }
  /**
   * Reversal: close the existing exposure first. The new opposite exposure is
   * planned again only after the broker confirms flat and risk is revalidated.
   */
  | {
      readonly kind: 'CLOSE_THEN_REVALIDATE';
      readonly side: Side;
      readonly quantity: number;
      readonly deferredTarget: number;
    }
  | { readonly kind: 'BLOCKED'; readonly reason: BlockReason };

function assertInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

export function planFollower(target: number, state: FollowerState, limits: PlanLimits): CopyPlan {
  assertInt(target, 'target');
  assertInt(state.actual, 'actual');
  assertInt(state.working, 'working');
  assertInt(state.reserved, 'reserved');

  // Unknown outcomes prevent use of the delta equation entirely; never blindly resend or flatten.
  if (state.unknownOutcomes > 0) return { kind: 'BLOCKED', reason: 'UNKNOWN_OUTCOME' };
  if (!state.stateFresh) return { kind: 'BLOCKED', reason: 'STALE_STATE' };

  const pending = state.working + state.reserved;
  const exposure = state.actual + pending;
  const delta = target - exposure;
  if (delta === 0) return { kind: 'NO_ACTION', reason: 'IN_SYNC' };

  // Opposing working orders are resolved or cancelled first, never netted blindly.
  if (pending !== 0 && Math.sign(pending) !== Math.sign(delta)) {
    return { kind: 'BLOCKED', reason: 'OPPOSING_WORKING_ORDERS' };
  }

  // Reversal: close, confirm flat, then revalidate. Never one oversized opposite order.
  if (exposure !== 0 && target !== 0 && Math.sign(exposure) !== Math.sign(target)) {
    return {
      kind: 'CLOSE_THEN_REVALIDATE',
      side: exposure > 0 ? 'SELL' : 'BUY',
      quantity: Math.abs(exposure),
      deferredTarget: target,
    };
  }

  const side: Side = delta > 0 ? 'BUY' : 'SELL';
  const quantity = Math.abs(delta);
  const increases = Math.abs(target) > Math.abs(exposure);

  if (!increases) {
    // Risk reductions are not blocked by entry halts or caps, so an account is never stranded.
    return { kind: 'ORDER', side, quantity, purpose: 'REDUCE' };
  }

  if (!limits.entriesAllowed) return { kind: 'BLOCKED', reason: 'ENTRIES_HALTED' };
  // A target above the cap is rejected, not silently clamped into a different strategy.
  if (Math.abs(target) > limits.maxAbsPosition) return { kind: 'BLOCKED', reason: 'CAP_EXCEEDED' };
  if (quantity > limits.maxOrderQuantity) return { kind: 'BLOCKED', reason: 'ORDER_SIZE_EXCEEDED' };
  return { kind: 'ORDER', side, quantity, purpose: 'INCREASE' };
}

export interface PreparedCommand {
  readonly side: Side;
  readonly quantity: number;
}

/**
 * Coalescing for commands that are prepared but not yet sent (TESTING.md
 * scenario 17). Re-plans as if the unsent command were withdrawn. If the fresh
 * plan is not exactly that command, the command is superseded and the fresh
 * plan applies, so a leader round trip that completes before dispatch never
 * becomes a late follower round trip. Sent or acknowledged commands are not
 * eligible: they need broker cancellation, not deletion.
 */
export function replanUnsent(
  target: number,
  state: FollowerState,
  limits: PlanLimits,
  prepared: PreparedCommand | null,
): { supersede: boolean; plan: CopyPlan } {
  if (!prepared) return { supersede: false, plan: planFollower(target, state, limits) };
  const signedPrepared = prepared.side === 'BUY' ? prepared.quantity : -prepared.quantity;
  const fresh = planFollower(target, { ...state, reserved: state.reserved - signedPrepared }, limits);
  const unchanged = fresh.kind === 'ORDER' && fresh.side === prepared.side && fresh.quantity === prepared.quantity;
  return unchanged ? { supersede: false, plan: { kind: 'NO_ACTION', reason: 'IN_SYNC' } } : { supersede: true, plan: fresh };
}
