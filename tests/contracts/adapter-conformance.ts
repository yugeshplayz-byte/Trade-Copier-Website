import { describe, expect, it } from 'vitest';
import {
  ORDER_TYPES,
  TERMINAL_ORDER_STATUSES,
  UnsupportedCapabilityError,
  eventEnvelopeSchema,
  type AccountRef,
  type BrokerAdapter,
  type EventEnvelope,
  type InstrumentKey,
  type OrderStatus,
  type PlaceOrder,
} from '@tradecopier/contracts';

/**
 * Provider-independent adapter conformance suite (TESTING.md "Adapter contract").
 * Every adapter must pass it before it can be enabled anywhere. Real-provider
 * harnesses run only against explicitly authorized practice accounts.
 */
export interface ConformanceHarness {
  readonly adapter: BrokerAdapter;
  readonly account: AccountRef;
  readonly instrument: InstrumentKey;
  /** Ensures market orders on `instrument` can fill. */
  prepareMarket(): Promise<void>;
  /** Lets pending fills and events settle (advance the simulator, or wait on a practice venue). */
  settle(): Promise<void>;
}

let sequence = 0;
function order(h: ConformanceHarness, overrides: Partial<PlaceOrder> = {}): PlaceOrder {
  const commandId = `conf-${++sequence}`;
  return {
    commandId,
    attemptId: `${commandId}-a1`,
    clientOrderId: `tc-${commandId}`,
    account: h.account,
    instrument: h.instrument,
    side: 'BUY',
    quantity: 1,
    orderType: 'MARKET',
    timeInForce: 'DAY',
    ...overrides,
  };
}

const STATUS_RANK: Record<OrderStatus, number> = {
  PENDING: 0,
  WORKING: 1,
  PENDING_CANCEL: 2,
  PARTIALLY_FILLED: 2,
  FILLED: 3,
  CANCELLED: 3,
  EXPIRED: 3,
  REJECTED: 3,
};

export function describeAdapterConformance(name: string, makeHarness: () => Promise<ConformanceHarness>): void {
  describe(`adapter conformance: ${name}`, () => {
    it('declares capabilities with no unknown order types', async () => {
      const { adapter } = await makeHarness();
      const caps = adapter.capabilities();
      for (const t of caps.orderTypes) expect(ORDER_TYPES).toContain(t);
      expect(caps.restrictions.length).toBeGreaterThanOrEqual(0);
    });

    it('rejects every undeclared order type with a typed error before sending', async () => {
      const h = await makeHarness();
      const declared = new Set(h.adapter.capabilities().orderTypes);
      for (const orderType of ORDER_TYPES.filter((t) => !declared.has(t))) {
        await expect(
          h.adapter.placeOrder(order(h, { orderType, limitPriceTicks: 1, stopPriceTicks: 1 })),
        ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
      }
      const snapshot = await h.adapter.getAccountState(h.account.canonicalAccountId);
      expect(snapshot.orders).toHaveLength(0);
    });

    it('emits schema-valid events with unique execution IDs and bounded cumulative fills', async () => {
      const h = await makeHarness();
      const events: EventEnvelope[] = [];
      h.adapter.subscribe((e) => events.push(e));
      await h.prepareMarket();
      const result = await h.adapter.placeOrder(order(h, { quantity: 3 }));
      expect(result.outcome).toBe('ACCEPTED');
      await h.settle();

      for (const e of events) expect(() => eventEnvelopeSchema.parse(e)).not.toThrow();
      const executions = events.flatMap((e) => (e.payload.kind === 'EXECUTION' ? [e.payload.execution] : []));
      expect(new Set(executions.map((x) => x.executionId)).size).toBe(executions.length);
      const filled = executions.reduce((sum, x) => sum + x.quantity, 0);
      expect(filled).toBeLessThanOrEqual(3);
      for (const x of executions) expect(Number.isSafeInteger(x.priceTicks)).toBe(true);
    });

    it('never regresses an order from a terminal state or lowers its version', async () => {
      const h = await makeHarness();
      const events: EventEnvelope[] = [];
      h.adapter.subscribe((e) => events.push(e));
      await h.prepareMarket();
      await h.adapter.placeOrder(order(h, { quantity: 2 }));
      await h.settle();
      const seen = new Map<string, { version: number; rank: number; terminal: boolean }>();
      for (const e of events) {
        if (e.payload.kind !== 'ORDER') continue;
        const o = e.payload.order;
        const prev = seen.get(o.brokerOrderId);
        if (prev) {
          expect(o.version).toBeGreaterThan(prev.version);
          expect(prev.terminal).toBe(false);
          expect(STATUS_RANK[o.status]).toBeGreaterThanOrEqual(prev.rank);
        }
        seen.set(o.brokerOrderId, { version: o.version, rank: STATUS_RANK[o.status], terminal: TERMINAL_ORDER_STATUSES.has(o.status) });
      }
      expect(seen.size).toBeGreaterThan(0);
    });

    it('returns well-formed snapshots with signed integer positions and a cursor', async () => {
      const h = await makeHarness();
      await h.prepareMarket();
      await h.adapter.placeOrder(order(h, { side: 'SELL', quantity: 2 }));
      await h.settle();
      const s = await h.adapter.getAccountState(h.account.canonicalAccountId);
      expect(Date.parse(s.requestedAt)).toBeLessThanOrEqual(Date.parse(s.receivedAt));
      expect(s.cursor).toMatch(/^\d+$/);
      expect(s.account.environment).toBe(h.account.environment);
      for (const p of s.positions) expect(Number.isSafeInteger(p.netQuantity)).toBe(true);
      expect(s.positions[0]?.netQuantity).toBe(-2);
    });

    it('pages execution history so every execution appears exactly once', async () => {
      const h = await makeHarness();
      await h.prepareMarket();
      for (let i = 0; i < 3; i++) await h.adapter.placeOrder(order(h));
      await h.settle();
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 100; guard++) {
        const page = await h.adapter.getExecutions(h.account.canonicalAccountId, cursor);
        ids.push(...page.executions.map((x) => x.executionId));
        if (page.complete || page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(ids.length).toBeGreaterThanOrEqual(3);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('finds an accepted order by client order ID', async () => {
      const h = await makeHarness();
      await h.prepareMarket();
      const cmd = order(h);
      const result = await h.adapter.placeOrder(cmd);
      await h.settle();
      const resolution = await h.adapter.lookupCommand({ account: h.account, clientOrderId: cmd.clientOrderId });
      expect(resolution.status).toBe('FOUND');
      if (resolution.status === 'FOUND' && result.outcome === 'ACCEPTED') {
        expect(resolution.order.brokerOrderId).toBe(result.brokerOrderId);
      }
    });

    it('does not let a cancel erase fills that already happened', async () => {
      const h = await makeHarness();
      await h.prepareMarket();
      const result = await h.adapter.placeOrder(order(h));
      await h.settle();
      if (result.outcome !== 'ACCEPTED') throw new Error('expected acceptance');
      await h.adapter.cancelOrder({
        commandId: 'cancel-1',
        attemptId: 'cancel-1-a1',
        account: h.account,
        brokerOrderId: result.brokerOrderId,
      });
      const s = await h.adapter.getAccountState(h.account.canonicalAccountId);
      const o = s.orders.find((x) => x.brokerOrderId === result.brokerOrderId);
      expect(o?.filledQuantity).toBe(1);
      expect(s.positions[0]?.netQuantity).toBe(1);
    });
  });
}
