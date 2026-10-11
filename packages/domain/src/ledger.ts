import type { Execution, OrderState } from '@tradecopier/contracts';

/**
 * Leader execution ledger for one account and contract (COPIER_ENGINE.md
 * "Primary mode: EXECUTION"). Only confirmed executions change the leader's
 * net position. Order status updates never do.
 */
export type LedgerResult =
  | { readonly kind: 'APPLIED'; readonly net: number }
  /** Same execution ID and same economic content: no additional effect. */
  | { readonly kind: 'DUPLICATE'; readonly net: number }
  /** Same execution ID with different content: an integrity incident, not a duplicate. */
  | { readonly kind: 'INTEGRITY_CONFLICT'; readonly executionId: string; readonly net: number }
  /** Corrections and busts need an explicit, reviewed ledger correction; entries hold meanwhile. */
  | { readonly kind: 'CORRECTION_REQUIRES_REVIEW'; readonly executionId: string; readonly net: number }
  /** Execution for a different account or contract than this ledger's scope. */
  | { readonly kind: 'OUT_OF_SCOPE'; readonly executionId: string; readonly net: number };

function economicKey(e: Execution): string {
  return JSON.stringify([e.brokerOrderId, e.side, e.quantity, e.priceTicks, e.canonicalAccountId, e.instrument]);
}

export class ExecutionLedger {
  private readonly seen = new Map<string, string>();
  private netPosition = 0;
  private readonly scopeAccount: string;
  private readonly scopeInstrument: string;

  constructor(canonicalAccountId: string, instrumentId: string) {
    this.scopeAccount = canonicalAccountId;
    this.scopeInstrument = instrumentId;
  }

  apply(execution: Execution, instrumentId: string): LedgerResult {
    if (execution.canonicalAccountId !== this.scopeAccount || instrumentId !== this.scopeInstrument) {
      return { kind: 'OUT_OF_SCOPE', executionId: execution.executionId, net: this.netPosition };
    }
    if (execution.correctionOf !== undefined) {
      return { kind: 'CORRECTION_REQUIRES_REVIEW', executionId: execution.executionId, net: this.netPosition };
    }
    const key = economicKey(execution);
    const previous = this.seen.get(execution.executionId);
    if (previous !== undefined) {
      return previous === key
        ? { kind: 'DUPLICATE', net: this.netPosition }
        : { kind: 'INTEGRITY_CONFLICT', executionId: execution.executionId, net: this.netPosition };
    }
    if (!Number.isSafeInteger(execution.quantity) || execution.quantity <= 0) {
      throw new RangeError('execution quantity must be a positive integer');
    }
    this.seen.set(execution.executionId, key);
    this.netPosition += execution.side === 'BUY' ? execution.quantity : -execution.quantity;
    return { kind: 'APPLIED', net: this.netPosition };
  }

  net(): number {
    return this.netPosition;
  }
}

/**
 * Latest known state per order. A lower or equal version never replaces a
 * higher one, so a stale "working" update cannot regress a filled order.
 */
export class OrderStateBook {
  private readonly orders = new Map<string, OrderState>();

  apply(order: OrderState): 'APPLIED' | 'IGNORED_STALE' {
    const current = this.orders.get(order.brokerOrderId);
    if (current && order.version <= current.version) return 'IGNORED_STALE';
    this.orders.set(order.brokerOrderId, order);
    return 'APPLIED';
  }

  get(brokerOrderId: string): OrderState | undefined {
    return this.orders.get(brokerOrderId);
  }
}
