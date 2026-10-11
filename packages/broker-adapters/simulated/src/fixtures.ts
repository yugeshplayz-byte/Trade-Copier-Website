import type { AccountRef, PlaceOrder } from '@tradecopier/contracts';
import { SIM_MNQ, SIM_MNQ_SPEC } from './catalog.ts';
import { SimulatedBroker, type SimulatedBrokerOptions } from './simulator.ts';

export { SIM_MNQ, SIM_MNQ_SPEC };

export const SIM_START = '2026-10-12T13:30:00.000Z';

export async function connectedSimulator(overrides: Partial<SimulatedBrokerOptions> = {}): Promise<SimulatedBroker> {
  const sim = new SimulatedBroker({
    seed: 42,
    startTime: SIM_START,
    accounts: [{ providerAccountId: 'LEADER-1' }, { providerAccountId: 'FOLLOWER-A' }, { providerAccountId: 'FOLLOWER-B' }],
    contracts: [SIM_MNQ_SPEC],
    ...overrides,
  });
  await sim.authenticate('sim:local');
  await sim.connect();
  return sim;
}

export function accountRef(providerAccountId: string): AccountRef {
  return {
    provider: 'simulated',
    environment: 'SIMULATED',
    providerAccountId,
    canonicalAccountId: `sim:${providerAccountId}`,
  };
}

let commandCounter = 0;

export function marketOrder(account: AccountRef, side: 'BUY' | 'SELL', quantity: number, id?: string): PlaceOrder {
  const commandId = id ?? `cmd-${++commandCounter}`;
  return {
    commandId,
    attemptId: `${commandId}-a1`,
    clientOrderId: `tc-${commandId}`,
    account,
    instrument: SIM_MNQ,
    side,
    quantity,
    orderType: 'MARKET',
    timeInForce: 'DAY',
  };
}
