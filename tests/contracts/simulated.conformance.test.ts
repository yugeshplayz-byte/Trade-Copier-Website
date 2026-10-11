import { SimulatedBroker } from '@tradecopier/broker-simulated';
import { SIM_MNQ, SIM_MNQ_SPEC, SIM_START } from '../../packages/broker-adapters/simulated/src/fixtures.ts';
import { describeAdapterConformance } from './adapter-conformance.ts';

describeAdapterConformance('simulated broker', async () => {
  // Small page size forces the pagination path.
  const adapter = new SimulatedBroker({
    seed: 1,
    startTime: SIM_START,
    accounts: [{ providerAccountId: 'CONF-1' }],
    contracts: [SIM_MNQ_SPEC],
    executionPageSize: 2,
  });
  await adapter.authenticate('sim:conformance');
  await adapter.connect();
  return {
    adapter,
    account: (await adapter.getAccounts())[0]!,
    instrument: SIM_MNQ,
    prepareMarket: async () => adapter.setMarket(SIM_MNQ, { bidTicks: 84000, askTicks: 84001, depth: 1 }),
    settle: async () => {
      for (let i = 0; i < 5; i++) adapter.advance(250);
    },
  };
});
