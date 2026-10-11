import { describe, expect, it } from 'vitest';
import { sizingPreview, validateGroupConfig, type AccountFacts, type GroupConfig } from './group-config.ts';

const ACCOUNTS: AccountFacts[] = [
  { id: 'L', environment: 'SIMULATED', connectionState: 'READY', label: 'Leader' },
  { id: 'A', environment: 'SIMULATED', connectionState: 'READY', label: 'Follower A' },
  { id: 'B', environment: 'SIMULATED', connectionState: 'READY', label: 'Follower B' },
  { id: 'P', environment: 'PROVIDER_PRACTICE', connectionState: 'READY', label: 'Practice' },
  { id: 'D', environment: 'SIMULATED', connectionState: 'DISCONNECTED', label: 'Down' },
];
const MNQ = { exchange: 'SIMEX', product: 'MNQ', expiry: '2026-12', currency: 'USD', providerContractId: 'SIM-MNQ-2026-12' };
const follower = (accountId: string, over = {}) => ({ accountId, numerator: 1, denominator: 1, maxAbsPosition: 4, maxOrderQuantity: 2, ...over });
const config = (over: Partial<GroupConfig> = {}): GroupConfig => ({
  schemaVersion: 1,
  leaderAccountId: 'L',
  followers: [follower('A'), follower('B', { numerator: 2 })],
  instruments: [MNQ],
  ...over,
});

describe('validateGroupConfig', () => {
  it('accepts one leader and two followers (the first vertical slice)', () => {
    expect(validateGroupConfig(config(), ACCOUNTS)).toEqual([]);
  });

  it('rejects the leader as a follower, duplicates and missing accounts', () => {
    const problems = validateGroupConfig(config({ followers: [follower('L'), follower('A'), follower('A'), follower('X')] }), ACCOUNTS);
    expect(problems).toEqual(
      expect.arrayContaining([
        'The leader cannot also be a follower.',
        'Follower A is listed more than once.',
        'A follower account was not found.',
      ]),
    );
  });

  it('rejects mixed environments and connections that are not ready', () => {
    const problems = validateGroupConfig(config({ followers: [follower('P'), follower('D')] }), ACCOUNTS);
    expect(problems).toEqual(
      expect.arrayContaining(['Practice is in a different environment from the leader.', 'Down: its connection is not ready.']),
    );
  });

  it('bounds sizing and caps, and reports every problem at once', () => {
    const problems = validateGroupConfig(
      config({
        followers: [
          follower('A', { numerator: 0 }),
          follower('B', { numerator: 50, denominator: 1, maxAbsPosition: 0, maxOrderQuantity: 5 }),
        ],
        instruments: [],
      }),
      ACCOUNTS,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        'Follower A: the size ratio must use whole numbers from 1 to 100.',
        'Follower B: the size ratio may be at most 10x.',
        'Follower B: the position cap must be 1 to 100 contracts.',
        'Follower B: the order size cap must be at least 1 and no more than the position cap.',
        'Choose at least one contract to copy.',
      ]),
    );
  });

  it('treats accounts the caller cannot see as missing', () => {
    expect(validateGroupConfig(config({ leaderAccountId: 'someone-elses' }), ACCOUNTS)).toContain('The leader account was not found.');
  });
});

describe('sizingPreview', () => {
  it('shows follower targets for sample leader positions, including rounding skips', () => {
    expect(sizingPreview({ numerator: 1, denominator: 2 })).toEqual([
      { leader: 1, follower: 0, skippedRounding: true },
      { leader: 2, follower: 1, skippedRounding: false },
      { leader: 3, follower: 1, skippedRounding: false },
      { leader: -1, follower: 0, skippedRounding: true },
    ]);
  });
});
