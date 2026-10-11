import type { Metadata } from 'next';
import { PROVIDER_EVIDENCE_REVIEWED_ON, PROVIDER_REGISTER, type ProviderStatus } from '@tradecopier/contracts';
import { StatusBadge } from '@/components/StatusBadge.tsx';
import type { Tone } from '@/lib/worker-status-view.ts';

export const metadata: Metadata = { title: 'Connections' };

const STATUS_VIEW: Record<ProviderStatus, { tone: Tone; label: string }> = {
  INTERNAL_TEST_ONLY: { tone: 'info', label: 'Internal test' },
  NOT_APPROVED: { tone: 'neutral', label: 'Not approved' },
  BLOCKED: { tone: 'danger', label: 'Blocked' },
};

export default function ConnectionsPage() {
  return (
    <>
      <header className="page-header">
        <div className="page-header__row">
          <h1>Connections</h1>
          <StatusBadge tone="neutral">Connecting disabled</StatusBadge>
        </div>
        <p className="page-header__meta">0 connections</p>
      </header>

      <p className="lede">
        No real broker provider is approved for this service, so real accounts cannot be connected. Simulated
        connections arrive in P3.
      </p>

      <section className="section" aria-labelledby="platforms-heading">
        <div className="section__head">
          <h2 id="platforms-heading">Platform eligibility</h2>
          <span className="section__meta">Evidence reviewed {PROVIDER_EVIDENCE_REVIEWED_ON}</span>
        </div>
        <p className="section__intro">
          Published API documentation does not grant commercial, hosting or account permission. Each platform stays
          off until written approval covers this deployment.
        </p>
        <div className="table-scroll" role="region" aria-labelledby="platforms-heading" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Platform</th>
                <th scope="col">Status</th>
                <th scope="col">Adapter</th>
                <th scope="col">Open review items</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDER_REGISTER.map((p) => (
                <tr key={p.id}>
                  <th scope="row" translate="no">
                    {p.name}
                  </th>
                  <td>
                    <StatusBadge tone={STATUS_VIEW[p.status].tone}>{STATUS_VIEW[p.status].label}</StatusBadge>
                  </td>
                  <td className="table__mono">{p.adapterImplemented ? 'Built' : 'None'}</td>
                  <td className="table__review">{p.classifications.length > 0 ? p.classifications.join(' · ') : '—'}</td>
                  <td className="table__notes">
                    {p.summary}
                    {p.sources.length > 0 && <span className="table__sources"> {p.sources.join(', ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
