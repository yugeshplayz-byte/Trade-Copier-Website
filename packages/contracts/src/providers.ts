import type { BrokerEnvironment } from './environment.ts';

/**
 * Eligibility status of a provider for customer use. Implementation and approval
 * are separate facts: a provider can be documented, or even coded, without being
 * approved for this deployment (BROKER_ADAPTERS.md).
 */
export type ProviderStatus =
  /** Owned simulator. Proves invariants only; never a real broker. */
  | 'INTERNAL_TEST_ONLY'
  /** No commercial, hosting or account-class approval on record. */
  | 'NOT_APPROVED'
  /** A reviewed restriction prohibits this deployment until resolved in writing. */
  | 'BLOCKED';

export type ReviewClassification =
  | 'ASSUMPTION'
  | 'REQUIRES VERIFICATION'
  | 'REQUIRES BROKER APPROVAL'
  | 'REQUIRES CONTRACT REVIEW'
  | 'REQUIRES LEGAL REVIEW'
  | 'FUTURE DECISION';

export interface ProviderEligibility {
  readonly id: ProviderId;
  readonly name: string;
  readonly status: ProviderStatus;
  /** Broker environments that could ever be routed if every gate passed. */
  readonly permittedEnvironments: readonly BrokerEnvironment[];
  /** Whether an adapter exists in this build. */
  readonly adapterImplemented: boolean;
  readonly classifications: readonly ReviewClassification[];
  readonly summary: string;
  /** Source IDs from docs/SOURCES.md. */
  readonly sources: readonly string[];
}

export const PROVIDER_IDS = ['simulated', 'tradovate', 'ninjatrader', 'rithmic', 'projectx', 'topstepx'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Date the public evidence behind this register was reviewed (docs/SOURCES.md). */
export const PROVIDER_EVIDENCE_REVIEWED_ON = '2026-10-11';

/**
 * Provider eligibility register. Changing a status requires written evidence for
 * this exact deployment; published API documentation alone never qualifies.
 */
export const PROVIDER_REGISTER: readonly ProviderEligibility[] = [
  {
    id: 'simulated',
    name: 'Simulated broker',
    status: 'INTERNAL_TEST_ONLY',
    permittedEnvironments: ['SIMULATED'],
    adapterImplemented: true,
    classifications: [],
    summary:
      'Deterministic simulator for proving copier invariants. It never reaches a real broker and does not represent real execution quality.',
    sources: [],
  },
  {
    id: 'tradovate',
    name: 'Tradovate',
    status: 'NOT_APPROVED',
    permittedEnvironments: [],
    adapterImplemented: false,
    classifications: ['ASSUMPTION', 'REQUIRES BROKER APPROVAL', 'REQUIRES CONTRACT REVIEW'],
    summary:
      'First investigation candidate. Commercial hosted multi-user permission, OAuth client approval, eligible accounts, quotas and fees are not verified.',
    sources: ['S01', 'S02', 'S03'],
  },
  {
    id: 'ninjatrader',
    name: 'NinjaTrader',
    status: 'NOT_APPROVED',
    permittedEnvironments: [],
    adapterImplemented: false,
    classifications: ['REQUIRES VERIFICATION', 'REQUIRES BROKER APPROVAL', 'REQUIRES CONTRACT REVIEW'],
    summary:
      'Enterprise API offering exists. Exact product, licence, hosting and account universe are unconfirmed. Treated as separate from Tradovate.',
    sources: ['S05'],
  },
  {
    id: 'rithmic',
    name: 'Rithmic',
    status: 'NOT_APPROVED',
    permittedEnvironments: [],
    adapterImplemented: false,
    classifications: ['REQUIRES BROKER APPROVAL', 'REQUIRES CONTRACT REVIEW'],
    summary:
      'Developer agreement, deployment rights, credentials, conformance and broker permission have not been obtained.',
    sources: ['S06'],
  },
  {
    id: 'projectx',
    name: 'ProjectX',
    status: 'NOT_APPROVED',
    permittedEnvironments: [],
    adapterImplemented: false,
    classifications: ['REQUIRES VERIFICATION', 'REQUIRES BROKER APPROVAL'],
    summary: 'Gateway documentation exists. Commercial authorization must be verified separately for each firm.',
    sources: ['S07'],
  },
  {
    id: 'topstepx',
    name: 'TopstepX',
    status: 'BLOCKED',
    permittedEnvironments: [],
    adapterImplemented: false,
    classifications: ['REQUIRES BROKER APPROVAL', 'REQUIRES CONTRACT REVIEW'],
    summary:
      'Hosted order routing disabled. Published guidance restricts remote-server order flow and excludes Live Funded API trading. Requires written permission covering this deployment.',
    sources: ['S04'],
  },
];

export function getProvider(id: ProviderId): ProviderEligibility {
  const provider = PROVIDER_REGISTER.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}
