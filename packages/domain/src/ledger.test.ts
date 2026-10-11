import { describe, expect, it } from 'vitest';
import type { Execution, OrderState } from '@tradecopier/contracts';
import { ExecutionLedger, OrderStateBook } from './ledger.ts';

const INSTRUMENT = { exchange: 'SIMEX', product: 'MNQ', expiry: '2026-12', currency: 'USD', providerContractId: 'SIM-MNQ-2026-12' };
const KEY = 'SIMEX|MNQ|2026-12|USD|SIM-MNQ-2026-12';
const ACCOUNT = 'sim:leader';

function fill(id: string, side: 'BUY' | 'SELL', quantity: number, extra: Partial<Execution> = {}): Execution {
  return {
    executionId: id,
    brokerOrderId: 'O-1',
    clientOrderId: 'c-1',
    canonicalAccountId: ACCOUNT,
    instrument: INSTRUMENT,
    side,
    quantity,
    priceTicks: 84000,
    occurredAt: '2026-10-12T13:30:00.000Z',
    ...extra,
  };
}

describe('ExecutionLedger', () => {
  it('scenario 1: the same buy execution delivered 100 times has one economic effect', () => {
    const ledger = new ExecutionLedger(ACCOUNT, KEY);
    const results = Array.from({ length: 100 }, () => ledger.apply(fill('X-1', 'BUY', 2), KEY).kind);
    expect(results[0]).toBe('APPLIED');
    expect(results.slice(1).every((k) => k === 'DUPLICATE')).toBe(true);
    expect(ledger.net()).toBe(2);
  });

  it('scenario 2: a stale lower fill status cannot reduce the economic total', () => {
    const ledger = new ExecutionLedger(ACCOUNT, KEY);
    const book = new OrderStateBook();
    ledger.apply(fill('X-1', 'BUY', 1), KEY);
    ledger.apply(fill('X-2', 'BUY', 1), KEY);
    const order = (filledQuantity: number, version: number): OrderState => ({
      brokerOrderId: 'O-1',
      clientOrderId: 'c-1',
      canonicalAccountId: ACCOUNT,
      instrument: INSTRUMENT,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 2,
      filledQuantity,
      status: filledQuantity === 2 ? 'FILLED' : 'PARTIALLY_FILLED',
      version,
      createdAt: '2026-10-12T13:30:00.000Z',
      updatedAt: '2026-10-12T13:30:00.000Z',
    });
    expect(book.apply(order(2, 3))).toBe('APPLIED');
    expect(book.apply(order(1, 2))).toBe('IGNORED_STALE');
    expect(book.get('O-1')?.filledQuantity).toBe(2);
    expect(ledger.net()).toBe(2);
  });

  it('treats the same execution ID with different content as an integrity conflict', () => {
    const ledger = new ExecutionLedger(ACCOUNT, KEY);
    ledger.apply(fill('X-1', 'BUY', 2), KEY);
    expect(ledger.apply(fill('X-1', 'BUY', 3), KEY)).toEqual({ kind: 'INTEGRITY_CONFLICT', executionId: 'X-1', net: 2 });
    expect(ledger.net()).toBe(2);
  });

  it('holds corrections for review instead of applying them', () => {
    const ledger = new ExecutionLedger(ACCOUNT, KEY);
    ledger.apply(fill('X-1', 'BUY', 2), KEY);
    expect(ledger.apply(fill('X-9', 'SELL', 2, { correctionOf: 'X-1' }), KEY).kind).toBe('CORRECTION_REQUIRES_REVIEW');
    expect(ledger.net()).toBe(2);
  });

  it('ignores executions for other accounts or contracts', () => {
    const ledger = new ExecutionLedger(ACCOUNT, KEY);
    expect(ledger.apply(fill('X-1', 'BUY', 1, { canonicalAccountId: 'sim:other' }), KEY).kind).toBe('OUT_OF_SCOPE');
    expect(ledger.apply(fill('X-2', 'BUY', 1), 'OTHER|KEY').kind).toBe('OUT_OF_SCOPE');
    expect(ledger.net()).toBe(0);
  });

  it('tracks signed net exposure through partial fills, exits and reversals', () => {
    const ledger = new ExecutionLedger(ACCOUNT, KEY);
    ledger.apply(fill('X-1', 'BUY', 1), KEY);
    ledger.apply(fill('X-2', 'BUY', 2), KEY);
    ledger.apply(fill('X-3', 'SELL', 4), KEY);
    expect(ledger.net()).toBe(-1);
  });
});
