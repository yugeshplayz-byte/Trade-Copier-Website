export type PhaseState = 'DONE' | 'IN_PROGRESS' | 'BLOCKED' | 'LATER';

export interface PhaseProgress {
  readonly phase: number;
  readonly title: string;
  readonly state: PhaseState;
  readonly note?: string;
}

/**
 * Roadmap position of this build (docs/ROADMAP.md). Update when a phase is
 * reviewed and merged; nothing here is computed or simulated.
 */
export const BUILD_PROGRESS: readonly PhaseProgress[] = [
  { phase: 0, title: 'Repository audit and protection', state: 'DONE' },
  { phase: 1, title: 'Foundation and safe application shell', state: 'DONE' },
  {
    phase: 2,
    title: 'Identity, tenant database and control API',
    state: 'BLOCKED',
    note: 'Needs local PostgreSQL and an authentication provider decision.',
  },
  {
    phase: 3,
    title: 'Adapter contracts and simulated broker',
    state: 'IN_PROGRESS',
    note: 'Contracts, tick math, simulator and conformance suite built; persistence waits for P2.',
  },
  { phase: 4, title: 'Durable execution with risk and reconciliation', state: 'LATER' },
  { phase: 5, title: 'Recovery and safety controls', state: 'LATER' },
  { phase: 6, title: 'Complete operational interface', state: 'LATER' },
];
