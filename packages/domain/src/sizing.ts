/**
 * Follower target sizing (COPIER_ENGINE.md "Sizing contracts").
 *
 * Targets are computed from the leader's cumulative signed net position, never
 * per partial fill, using integer arithmetic with magnitude rounded down. A
 * fractional result is never rounded up to one contract.
 */

export type SizingRule =
  /** MVP. T(L) = sign(L) * floor(|L| * numerator / denominator). */
  | { readonly kind: 'MULTIPLIER'; readonly numerator: number; readonly denominator: number }
  /**
   * Beta. With the leader's original opening order quantity Q0 frozen at a flat
   * start, T = sign(L) * floor(K * |L| / Q0). Scaling in beyond Q0 is unsupported.
   */
  | { readonly kind: 'FIXED_OPENING_QUANTITY'; readonly quantity: number; readonly openingOrderQuantity: number };

export type TargetResult =
  | {
      readonly kind: 'TARGET';
      readonly target: number;
      /** Leader has exposure but the follower target rounds to zero: a visible skip, not an error. */
      readonly skippedRounding: boolean;
    }
  | { readonly kind: 'UNSUPPORTED'; readonly reason: 'SCALE_IN_BEYOND_OPENING_ORDER' };

export class SizingRuleError extends Error {
  override readonly name = 'SizingRuleError';
}

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SizingRuleError(`${label} must be a positive integer`);
}

export function validateSizingRule(rule: SizingRule): void {
  if (rule.kind === 'MULTIPLIER') {
    positiveSafeInteger(rule.numerator, 'numerator');
    positiveSafeInteger(rule.denominator, 'denominator');
  } else {
    positiveSafeInteger(rule.quantity, 'quantity');
    positiveSafeInteger(rule.openingOrderQuantity, 'openingOrderQuantity');
  }
}

/** Computes the follower's signed target position for the leader's cumulative signed net position. */
export function computeTarget(leaderNet: number, rule: SizingRule): TargetResult {
  if (!Number.isSafeInteger(leaderNet)) throw new RangeError('leaderNet must be a safe integer');
  validateSizingRule(rule);

  const absLeader = Math.abs(leaderNet);
  let numerator: number;
  let denominator: number;
  if (rule.kind === 'MULTIPLIER') {
    numerator = rule.numerator;
    denominator = rule.denominator;
  } else {
    if (absLeader > rule.openingOrderQuantity) {
      return { kind: 'UNSUPPORTED', reason: 'SCALE_IN_BEYOND_OPENING_ORDER' };
    }
    numerator = rule.quantity;
    denominator = rule.openingOrderQuantity;
  }

  // BigInt division truncates toward zero, which is floor for non-negative magnitudes.
  const magnitude = Number((BigInt(absLeader) * BigInt(numerator)) / BigInt(denominator));
  if (!Number.isSafeInteger(magnitude)) throw new RangeError('target exceeds the safe integer range');
  const target = magnitude === 0 ? 0 : leaderNet < 0 ? -magnitude : magnitude;
  return { kind: 'TARGET', target, skippedRounding: leaderNet !== 0 && target === 0 };
}
