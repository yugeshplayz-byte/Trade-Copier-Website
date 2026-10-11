export interface Section {
  readonly href: string;
  readonly label: string;
  /** Present for sections not built yet. */
  readonly planned?: {
    /** Short roadmap reference shown in navigation, e.g. "P3". */
    readonly phaseTag: string;
    readonly purpose: string;
    readonly deliveredIn: string;
    readonly dependsOn: string;
  };
}

/** Primary app navigation (FRONTEND.md product hierarchy). */
export const SECTIONS: readonly Section[] = [
  { href: '/overview', label: 'Overview' },
  {
    href: '/copiers',
    label: 'Copiers',
    planned: {
      phaseTag: 'P3–4',
      purpose: 'Create and operate copier groups: one leader, its followers, sizing rules, pause, halt and flatten.',
      deliveredIn: 'Phases 3–4 (simulated engine), Phase 6 (full interface)',
      dependsOn: 'Tenant database, simulated broker and the durable execution slice.',
    },
  },
  {
    href: '/accounts',
    label: 'Accounts',
    planned: {
      phaseTag: 'P3',
      purpose: 'Inspect each account’s broker-reported positions, orders, balance and freshness.',
      deliveredIn: 'Phase 3 (simulated accounts)',
      dependsOn: 'Adapter contracts and the simulated broker.',
    },
  },
  { href: '/connections', label: 'Connections' },
  {
    href: '/activity',
    label: 'Activity',
    planned: {
      phaseTag: 'P4',
      purpose: 'Trace every follower action back to its leader fill, risk decision and broker outcome.',
      deliveredIn: 'Phase 4',
      dependsOn: 'Durable event, intent and command ledger.',
    },
  },
  {
    href: '/risk',
    label: 'Risk',
    planned: {
      phaseTag: 'P4–5',
      purpose: 'Configure instrument allowlists, quantity and position caps, entry halts and loss latches.',
      deliveredIn: 'Phases 4–5',
      dependsOn: 'Risk reservations and the execution slice.',
    },
  },
  {
    href: '/billing',
    label: 'Billing',
    planned: {
      phaseTag: 'P9',
      purpose: 'Subscription status and entitlements. Exits stay available regardless of billing state.',
      deliveredIn: 'Phase 9 (payment provider test mode only)',
      dependsOn: 'Approved plans; no prices are set.',
    },
  },
  { href: '/settings', label: 'Settings' },
  { href: '/help', label: 'Help' },
];

export function getSection(href: string): Section {
  const section = SECTIONS.find((s) => s.href === href);
  if (!section) throw new Error(`Unknown section ${href}`);
  return section;
}
