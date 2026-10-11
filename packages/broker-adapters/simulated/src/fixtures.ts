import type { AccountRef, ContractSpec, InstrumentKey, PlaceOrder } from '@tradecopier/contracts';
import { SimulatedBroker, type SimulatedBrokerOptions } from './simulator.ts';

/** Synthetic contract for tests: a micro index future with a 0.25 tick. Not real market data. */
export const SIM_MNQ: InstrumentKey = {
  exchange: 'SIMEX',
  product: 'MNQ',
  expiry: '2026-12',
  currency: 'USD',
  providerContractId: 'SIM-MNQ-2026-12',
};

export const SIM_MNQ_SPEC: ContractSpec = {
  instrument: SIM_MNQ,
  tickSize: '0.25',
  tickValue: '0.50',
  lotIncrement: 1,
  specVersion: 1,
};

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
