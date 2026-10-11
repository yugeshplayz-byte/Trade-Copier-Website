import { computeTarget } from './sizing.ts';

/** Per-follower settings. Sizing applies to the leader's cumulative net position. */
export interface FollowerSettings {
  readonly accountId: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly maxAbsPosition: number;
  readonly maxOrderQuantity: number;
}

export interface InstrumentRef {
  readonly exchange: string;
  readonly product: string;
  readonly expiry: string;
  readonly currency: string;
  readonly providerContractId: string;
}

/** Immutable copier configuration (one settings version). EXECUTION mode only. */
export interface GroupConfig {
  readonly schemaVersion: 1;
  readonly leaderAccountId: string;
  readonly followers: readonly FollowerSettings[];
  readonly instruments: readonly InstrumentRef[];
}

/** Facts about an account the caller is authorized to use, as stored for the tenant. */
export interface AccountFacts {
  readonly id: string;
  readonly environment: string;
  readonly connectionState: string;
  readonly label: string;
}

export const GROUP_LIMITS = {
  maxFollowers: 5,
  /** Largest allowed multiplier (numerator / denominator). */
  maxRatio: 10,
  maxRatioTerm: 100,
  maxPosition: 100,
} as const;

/**
 * Validates a draft configuration against the tenant's accounts. Returns every
 * problem at once (FRONTEND.md: show all blockers together); empty means valid.
 * Accounts not in `accounts` are treated as nonexistent, so other tenants'
 * accounts are indistinguishable from missing ones.
 */
export function validateGroupConfig(config: GroupConfig, accounts: readonly AccountFacts[]): string[] {
  const problems: string[] = [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const leader = byId.get(config.leaderAccountId);
  if (!leader) problems.push('The leader account was not found.');

  if (config.followers.length === 0) problems.push('Choose at least one follower account.');
  if (config.followers.length > GROUP_LIMITS.maxFollowers) {
    problems.push(`A copier can have at most ${GROUP_LIMITS.maxFollowers} followers.`);
  }

  const seen = new Set<string>();
  for (const f of config.followers) {
    const account = byId.get(f.accountId);
    const name = account?.label ?? 'A follower';
    if (!account) problems.push('A follower account was not found.');
    if (f.accountId === config.leaderAccountId) problems.push('The leader cannot also be a follower.');
    if (seen.has(f.accountId)) problems.push(`${name} is listed more than once.`);
    seen.add(f.accountId);

    const termsOk = [f.numerator, f.denominator].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= GROUP_LIMITS.maxRatioTerm);
    if (!termsOk) problems.push(`${name}: the size ratio must use whole numbers from 1 to ${GROUP_LIMITS.maxRatioTerm}.`);
    else if (f.numerator > f.denominator * GROUP_LIMITS.maxRatio) problems.push(`${name}: the size ratio may be at most ${GROUP_LIMITS.maxRatio}x.`);

    if (!Number.isSafeInteger(f.maxAbsPosition) || f.maxAbsPosition < 1 || f.maxAbsPosition > GROUP_LIMITS.maxPosition) {
      problems.push(`${name}: the position cap must be 1 to ${GROUP_LIMITS.maxPosition} contracts.`);
    }
    if (!Number.isSafeInteger(f.maxOrderQuantity) || f.maxOrderQuantity < 1 || f.maxOrderQuantity > f.maxAbsPosition) {
      problems.push(`${name}: the order size cap must be at least 1 and no more than the position cap.`);
    }
    if (leader && account && account.environment !== leader.environment) {
      problems.push(`${name} is in a different environment from the leader.`);
    }
  }

  for (const id of [config.leaderAccountId, ...config.followers.map((f) => f.accountId)]) {
    const account = byId.get(id);
    if (account && account.connectionState !== 'READY') {
      problems.push(`${account.label}: its connection is not ready.`);
    }
  }

  if (config.instruments.length === 0) problems.push('Choose at least one contract to copy.');
  return [...new Set(problems)];
}

/** Follower targets for sample leader positions, for the review screen. */
export function sizingPreview(follower: Pick<FollowerSettings, 'numerator' | 'denominator'>, leaderPositions: readonly number[] = [1, 2, 3, -1]) {
  return leaderPositions.map((leader) => {
    const result = computeTarget(leader, { kind: 'MULTIPLIER', numerator: follower.numerator, denominator: follower.denominator });
    return result.kind === 'TARGET'
      ? { leader, follower: result.target, skippedRounding: result.skippedRounding }
      : { leader, follower: 0, skippedRounding: false };
  });
}
