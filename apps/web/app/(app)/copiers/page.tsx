import type { Metadata } from 'next';
import { CopiersPanel } from '@/components/CopiersPanel.tsx';
import { StatusBadge } from '@/components/StatusBadge.tsx';
import { getServerConfig } from '@/lib/server-config.ts';

export const metadata: Metadata = { title: 'Copiers' };

export default function CopiersPage() {
  const result = getServerConfig();
  const authConfigured = result.ok && result.config.auth.configured;
  return (
    <>
      <header className="page-header">
        <div className="page-header__row">
          <h1>Copiers</h1>
          <StatusBadge tone="info">Simulator only</StatusBadge>
        </div>
        <p className="page-header__meta">Order copying starts in the next slice; activation checks run now.</p>
      </header>
      <section className="section" aria-labelledby="copiers-heading">
        <div className="section__head">
          <h2 id="copiers-heading">Your copiers</h2>
          <span className="section__meta">Activated by the execution worker</span>
        </div>
        {authConfigured ? <CopiersPanel /> : <p className="empty">Sign-in is not configured, so copiers cannot be created.</p>}
      </section>
    </>
  );
}
