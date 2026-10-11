import type { ContractSpec, InstrumentKey } from '@tradecopier/contracts';
import type { SimulatedAccountConfig } from './simulator.ts';

/** Synthetic micro index future with a 0.25 tick. Simulator only; not real market data. */
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

export const SIMULATED_CONTRACTS: readonly ContractSpec[] = [SIM_MNQ_SPEC];

/** Accounts every simulated connection exposes: one leader candidate and two followers. */
export const SIMULATED_ACCOUNT_SET: readonly (SimulatedAccountConfig & { displayName: string })[] = [
  { providerAccountId: 'SIM-LEADER-1', displayName: 'Simulated leader 1' },
  { providerAccountId: 'SIM-FOLLOWER-A', displayName: 'Simulated follower A' },
  { providerAccountId: 'SIM-FOLLOWER-B', displayName: 'Simulated follower B' },
];
