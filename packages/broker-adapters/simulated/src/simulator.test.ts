import { describe, expect, it } from 'vitest';
import {
  SequenceTracker,
  UnsupportedCapabilityError,
  eventEnvelopeSchema,
  type EventEnvelope,
  type Execution,
} from '@tradecopier/contracts';
import { SIM_MNQ, accountRef, connectedSimulator, marketOrder } from './fixtures.ts';

const LEADER = accountRef('LEADER-1');
const FOLLOWER = accountRef('FOLLOWER-A');

function collect(sim: { subscribe(h: (e: EventEnvelope) => void): unknown }): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  sim.subscribe((e) => events.push(e));
  return events;
}

describe('determinism', () => {
  async function script(seed: number) {
    const sim = await connectedSimulator({ seed });
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001, depth: 'RANDOM' });
    await sim.placeOrder(marketOrder(LEADER, 'BUY', 7, `det-${seed}-1`));
    for (let i = 0; i < 6; i++) sim.advance(250);
    await sim.placeOrder(marketOrder(LEADER, 'SELL', 7, `det-${seed}-2`));
    for (let i = 0; i < 6; i++) sim.advance(250);
    return sim.eventLog().map((e) => ({ ...e, payload: e.payload }));
  }

  it('produces an identical event log for the same seed and calls', async () => {
    expect(await script(7)).toEqual(await script(7));
  });

  it('emits only schema-valid envelopes', async () => {
    for (const event of await script(11)) expect(() => eventEnvelopeSchema.parse(event)).not.toThrow();
  });
});

describe('fills', () => {
  it('fills a market order in partial executions over steps, cumulatively', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001, depth: 1 });
    const result = await sim.placeOrder(marketOrder(LEADER, 'BUY', 3));
    expect(result.outcome).toBe('ACCEPTED');
    sim.advance(100);
    sim.advance(100);
    const executions = (await sim.getExecutions(LEADER.canonicalAccountId)).executions;
    expect(executions.map((e: Execution) => e.quantity)).toEqual([1, 1, 1]);
    expect(new Set(executions.map((e) => e.executionId)).size).toBe(3);
    const snapshot = await sim.getAccountState(LEADER.canonicalAccountId);
    expect(snapshot.positions[0]?.netQuantity).toBe(3);
    expect(snapshot.orders[0]).toMatchObject({ status: 'FILLED', filledQuantity: 3 });
  });

  it('rests a limit order and fills it when the market gaps through it', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    const order = { ...marketOrder(LEADER, 'BUY', 2), orderType: 'LIMIT' as const, limitPriceTicks: 83990 };
    await sim.placeOrder(order);
    expect((await sim.getExecutions(LEADER.canonicalAccountId)).executions).toHaveLength(0);
    sim.setMarket(SIM_MNQ, { bidTicks: 83980, askTicks: 83981 });
    const [fill] = (await sim.getExecutions(LEADER.canonicalAccountId)).executions;
    expect(fill).toMatchObject({ quantity: 2, priceTicks: 83981 });
  });

  it('rejects market orders when the market is closed instead of filling later', async () => {
    const sim = await connectedSimulator();
    const result = await sim.placeOrder(marketOrder(LEADER, 'BUY', 1));
    expect(result).toMatchObject({ outcome: 'REJECTED', code: 'MARKET_CLOSED', retryable: false });
  });
});

describe('ambiguous submissions', () => {
  it('returns UNKNOWN when the response is lost after acceptance, and lookup finds the order', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    sim.injectSubmitFault('placeOrder', 'TIMEOUT_AFTER_ACCEPT');
    const cmd = marketOrder(FOLLOWER, 'BUY', 2);
    const result = await sim.placeOrder(cmd);
    expect(result).toEqual({ outcome: 'UNKNOWN', attemptId: cmd.attemptId, reason: expect.any(String) });
    const resolution = await sim.lookupCommand({ account: FOLLOWER, clientOrderId: cmd.clientOrderId });
    expect(resolution).toMatchObject({ status: 'FOUND', order: { filledQuantity: 2 } });
  });

  it('proves why UNKNOWN must never be resent: without broker dedupe a resend doubles exposure', async () => {
    const sim = await connectedSimulator();
    expect(sim.capabilities().submissionDeduplication).toBe('UNSUPPORTED');
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    sim.injectSubmitFault('placeOrder', 'TIMEOUT_AFTER_ACCEPT');
    const cmd = marketOrder(FOLLOWER, 'BUY', 2);
    await sim.placeOrder(cmd);
    await sim.placeOrder({ ...cmd, attemptId: `${cmd.commandId}-a2` }); // what a blind retry would do
    const snapshot = await sim.getAccountState(FOLLOWER.canonicalAccountId);
    expect(snapshot.positions[0]?.netQuantity).toBe(4);
    expect(await sim.lookupCommand({ account: FOLLOWER, clientOrderId: cmd.clientOrderId })).toMatchObject({
      status: 'AMBIGUOUS',
    });
  });

  it('with certified dedupe enabled, a resend maps to the same broker order', async () => {
    const sim = await connectedSimulator({ deduplicateClientOrderIds: true });
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    const cmd = marketOrder(FOLLOWER, 'BUY', 2);
    const first = await sim.placeOrder(cmd);
    const second = await sim.placeOrder({ ...cmd, attemptId: `${cmd.commandId}-a2` });
    expect(second).toEqual({ ...first, acknowledgedAt: expect.any(String) });
    expect((await sim.getAccountState(FOLLOWER.canonicalAccountId)).positions[0]?.netQuantity).toBe(2);
  });

  it('treats an empty lookup during the visibility delay as inconclusive', async () => {
    const sim = await connectedSimulator({ historyVisibilityDelayMs: 2_000 });
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    sim.injectSubmitFault('placeOrder', 'TIMEOUT_AFTER_ACCEPT');
    const cmd = marketOrder(FOLLOWER, 'BUY', 1);
    await sim.placeOrder(cmd);
    expect(await sim.lookupCommand({ account: FOLLOWER, clientOrderId: cmd.clientOrderId })).toEqual({
      status: 'NOT_FOUND',
      conclusive: false,
      reason: expect.any(String),
    });
    sim.advance(2_000);
    expect((await sim.lookupCommand({ account: FOLLOWER, clientOrderId: cmd.clientOrderId })).status).toBe('FOUND');
  });

  it('marks failures before send as retryable with no order created', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    sim.injectSubmitFault('placeOrder', 'FAIL_BEFORE_SEND');
    const cmd = marketOrder(FOLLOWER, 'BUY', 1);
    expect(await sim.placeOrder(cmd)).toMatchObject({ outcome: 'REJECTED', code: 'NOT_SENT', retryable: true });
    expect((await sim.getAccountState(FOLLOWER.canonicalAccountId)).orders).toHaveLength(0);
  });
});

describe('rejections and capabilities', () => {
  it('rejects risk-increasing orders beyond the simulated margin limit, non-retryably', async () => {
    const sim = await connectedSimulator({
      accounts: [{ providerAccountId: 'FOLLOWER-A', maxAbsPosition: 2 }],
    });
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    expect((await sim.placeOrder(marketOrder(FOLLOWER, 'BUY', 2))).outcome).toBe('ACCEPTED');
    expect(await sim.placeOrder(marketOrder(FOLLOWER, 'BUY', 1))).toMatchObject({
      code: 'INSUFFICIENT_MARGIN',
      retryable: false,
    });
    // A risk-reducing close is still accepted.
    expect((await sim.placeOrder(marketOrder(FOLLOWER, 'SELL', 2))).outcome).toBe('ACCEPTED');
  });

  it('throws a typed capability error for unsupported order types instead of substituting', async () => {
    const sim = await connectedSimulator();
    const stop = { ...marketOrder(LEADER, 'SELL', 1), orderType: 'STOP' as const, stopPriceTicks: 83000 };
    await expect(sim.placeOrder(stop)).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(sim.flattenAccount()).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    expect((await sim.getAccountState(LEADER.canonicalAccountId)).orders).toHaveLength(0);
  });

  it('rejects unknown contracts and foreign accounts', async () => {
    const sim = await connectedSimulator();
    const wrongContract = { ...marketOrder(LEADER, 'BUY', 1), instrument: { ...SIM_MNQ, expiry: '2027-03' } };
    expect(await sim.placeOrder(wrongContract)).toMatchObject({ code: 'INVALID_CONTRACT' });
    const live = { ...marketOrder(LEADER, 'BUY', 1), account: { ...LEADER, environment: 'LIVE' as const } };
    expect(await sim.placeOrder(live)).toMatchObject({ code: 'ACCOUNT_NOT_AUTHORIZED' });
  });
});

describe('cancellation races', () => {
  it('cannot cancel a filled order, and fills stand', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    const accepted = await sim.placeOrder(marketOrder(LEADER, 'BUY', 1));
    if (accepted.outcome !== 'ACCEPTED') throw new Error('expected acceptance');
    const cancel = await sim.cancelOrder({ commandId: 'c1', attemptId: 'c1-a1', account: LEADER, brokerOrderId: accepted.brokerOrderId });
    expect(cancel).toMatchObject({ outcome: 'REJECTED', code: 'ORDER_NOT_CANCELLABLE' });
    expect((await sim.getAccountState(LEADER.canonicalAccountId)).positions[0]?.netQuantity).toBe(1);
  });

  it('cancelling a partially filled order keeps the filled quantity', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001, depth: 1 });
    const accepted = await sim.placeOrder(marketOrder(LEADER, 'BUY', 3));
    if (accepted.outcome !== 'ACCEPTED') throw new Error('expected acceptance');
    await sim.cancelOrder({ commandId: 'c2', attemptId: 'c2-a1', account: LEADER, brokerOrderId: accepted.brokerOrderId });
    sim.advance(100);
    const snapshot = await sim.getAccountState(LEADER.canonicalAccountId);
    expect(snapshot.orders[0]).toMatchObject({ status: 'CANCELLED', filledQuantity: 1 });
    expect(snapshot.positions[0]?.netQuantity).toBe(1);
  });
});

describe('connectivity and stream faults', () => {
  it('keeps broker-held orders working while disconnected; history recovers what the stream missed', async () => {
    const sim = await connectedSimulator();
    const events = collect(sim);
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    await sim.placeOrder({ ...marketOrder(LEADER, 'BUY', 1), orderType: 'LIMIT', limitPriceTicks: 83990 });
    const deliveredBefore = events.length;

    await sim.disconnect();
    expect(await sim.placeOrder(marketOrder(LEADER, 'BUY', 1))).toMatchObject({ code: 'NOT_CONNECTED', retryable: true });
    sim.setMarket(SIM_MNQ, { bidTicks: 83980, askTicks: 83985 }); // resting order fills at the broker
    expect(events.length).toBe(deliveredBefore);

    await sim.connect();
    const history = await sim.getExecutions(LEADER.canonicalAccountId);
    expect(history.executions).toHaveLength(1);
    const snapshot = await sim.getAccountState(LEADER.canonicalAccountId);
    expect(snapshot.positions[0]?.netQuantity).toBe(1);
    expect(Number(snapshot.cursor)).toBeGreaterThan(Number(events.at(-1)!.providerSequence));
  });

  it('makes dropped, duplicated and reordered events detectable by sequence', async () => {
    const sim = await connectedSimulator();
    const events = collect(sim);
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    sim.injectStreamFault('DUPLICATE_NEXT');
    sim.injectStreamFault('DROP_NEXT');
    sim.injectStreamFault('SWAP_NEXT_TWO');
    await sim.placeOrder(marketOrder(LEADER, 'BUY', 1)); // emits ORDER, EXECUTION, ORDER, POSITION

    const tracker = new SequenceTracker();
    const kinds = events.map((e) => tracker.observe(e.sequenceScopeKey!, Number(e.providerSequence)).kind);
    expect(kinds).toEqual(['FIRST', 'DUPLICATE', 'GAP', 'LATE']);
    expect(tracker.outstandingGaps(LEADER.canonicalAccountId)).toEqual([2]);
  });

  it('can serve a stale snapshot whose cursor lags the stream', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    await sim.placeOrder(marketOrder(LEADER, 'BUY', 1));
    sim.injectSnapshotFault('STALE');
    const stale = await sim.getAccountState(LEADER.canonicalAccountId);
    const fresh = await sim.getAccountState(LEADER.canonicalAccountId);
    expect(Number(stale.cursor)).toBe(Number(fresh.cursor) - 1);
  });

  it('requires re-authentication after token expiry and refuses orders non-retryably', async () => {
    const sim = await connectedSimulator();
    sim.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001 });
    sim.expireAuthentication();
    expect(sim.connectionState()).toBe('AUTH_REQUIRED');
    expect(await sim.placeOrder(marketOrder(LEADER, 'BUY', 1))).toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
    await sim.authenticate('sim:local');
    expect(await sim.connect()).toBe('READY');
  });
});
