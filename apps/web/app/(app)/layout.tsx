import { withAuth } from '@workos-inc/authkit-nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/components/AccountMenu.tsx';
import { BrandLockup } from '@/components/BrandMark.tsx';
import { PrimaryNav } from '@/components/PrimaryNav.tsx';
import { WorkerStatusBadge, WorkerStatusProvider } from '@/components/WorkerStatus.tsx';
import { SECTIONS } from '@/lib/sections.ts';
import { getServerConfig } from '@/lib/server-config.ts';
import { displayNameOf } from '@/lib/server/auth.ts';
import { classifyWorkerHealth, probeWorker } from '@/lib/worker-health.ts';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const result = getServerConfig();
  if (!result.ok) return null; // The root layout renders the refusal.
  const { config } = result;

  const probe = await probeWorker(config.worker.healthHost, config.worker.healthPort);
  const initialStatus = classifyWorkerHealth(probe, config.appEnv, new Date());
  const authConfigured = config.auth.configured;
  const user = authConfigured ? (await withAuth()).user : null;
  const userName = user ? displayNameOf(user) || user.email : null;
  const navItems = SECTIONS.map((s) => ({ href: s.href, label: s.label, phaseTag: s.planned?.phaseTag ?? null }));

  return (
    <WorkerStatusProvider initial={initialStatus}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        <header className="topbar">
          <Link href="/overview" className="brand" aria-label="Tradeplex overview" translate="no">
            <BrandLockup />
          </Link>
          <dl className="env-readout" aria-label="Environment">
            <div>
              <dt>Env</dt>
              <dd translate="no">{config.appEnv}</dd>
            </div>
            <div>
              <dt>Broker</dt>
              <dd>Simulator</dd>
            </div>
            <div>
              <dt>Dispatch</dt>
              <dd>Off</dd>
            </div>
          </dl>
          <div className="topbar__actions">
            <WorkerStatusBadge />
            <button type="button" className="btn btn--halt" disabled aria-describedby="halt-note">
              Halt new entries
            </button>
            <span id="halt-note" className="sr-only">
              Unavailable: no copiers exist yet.
            </span>
            {userName ? (
              <AccountMenu name={userName} email={user?.email ?? null} />
            ) : (
              !authConfigured && <span className="session__off">Sign-in not configured</span>
            )}
          </div>
        </header>
        <p className="notice">
          <strong>Development build.</strong> {authConfigured ? 'Simulator only, no broker connection.' : 'No sign-in, no broker connection.'} Orders cannot be sent.
        </p>
        <PrimaryNav items={navItems} />
        <main id="main" className="workspace" tabIndex={-1}>
          {children}
        </main>
      </div>
    </WorkerStatusProvider>
  );
}
