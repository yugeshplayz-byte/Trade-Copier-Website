import type { Metadata } from 'next';
import { StatusBadge } from '@/components/StatusBadge.tsx';
import { WorkerStatusDetail } from '@/components/WorkerStatus.tsx';
import { BUILD_PROGRESS, type PhaseState } from '@/lib/build-progress.ts';
import { formatDateTime } from '@/lib/format.ts';
import { getServerConfig } from '@/lib/server-config.ts';
import type { Tone } from '@/lib/worker-status-view.ts';

export const metadata: Metadata = { title: 'Overview' };

const PHASE_VIEW: Record<PhaseState, { tone: Tone; label: string }> = {
  DONE: { tone: 'ok', label: 'Done' },
  IN_PROGRESS: { tone: 'info', label: 'In progress' },
  BLOCKED: { tone: 'warn', label: 'Blocked' },
  LATER: { tone: 'neutral', label: 'Later' },
};

export default function OverviewPage() {
  const result = getServerConfig();
  if (!result.ok) return null;
  const { config } = result;

  return (
    <>
      <header className="page-header">
        <h1>Overview</h1>
        <p className="page-header__meta">Rendered {formatDateTime(new Date().toISOString())}</p>
      </header>

      <section aria-labelledby="status-heading">
        <h2 id="status-heading" className="sr-only">
          System status
        </h2>
        <dl className="readout">
          <div className="readout__cell">
            <dt className="readout__label">Environment</dt>
            <dd>
              <span className="readout__value" translate="no">
                {config.appEnv}
              </span>
              <span className="readout__caption">Local development. Separate from staging and production.</span>
            </dd>
          </div>
          <div className="readout__cell">
            <dt className="readout__label">Broker</dt>
            <dd>
              <span className="readout__value">Simulator only</span>
              <span className="readout__caption">No real provider is approved or connected.</span>
            </dd>
          </div>
          <div className="readout__cell">
            <dt className="readout__label">Order dispatch</dt>
            <dd>
              <span className="readout__value">
                <StatusBadge tone="neutral">Off</StatusBadge>
              </span>
              <span className="readout__caption">No adapter is registered for order dispatch until Phase 4.</span>
            </dd>
          </div>
          <div className="readout__cell">
            <dt className="readout__label">Execution worker</dt>
            <dd>
              <WorkerStatusDetail />
            </dd>
          </div>
        </dl>
      </section>

      <div className="overview-grid">
        <section className="section" aria-labelledby="progress-heading">
          <div className="section__head">
            <h2 id="progress-heading">Build progress</h2>
            <span className="section__meta">docs/ROADMAP.md</span>
          </div>
          <ol className="progress">
            {BUILD_PROGRESS.map((p) => (
              <li key={p.phase} className={`progress__item progress__item--${p.state.toLowerCase()}`}>
                <span className="progress__phase">P{p.phase}</span>
                <span className="progress__body">
                  <span className="progress__title">{p.title}</span>
                  {p.note && <span className="progress__note">{p.note}</span>}
                </span>
                <StatusBadge tone={PHASE_VIEW[p.state].tone}>{PHASE_VIEW[p.state].label}</StatusBadge>
              </li>
            ))}
          </ol>
        </section>

        <div className="overview-side">
          <section className="section" aria-labelledby="copiers-heading">
            <div className="section__head">
              <h2 id="copiers-heading">Copiers</h2>
              <span className="section__meta">0</span>
            </div>
            <p className="empty">
              None yet. Copier groups need the simulated broker and the durable execution slice (P3–P4).
            </p>
          </section>

          <aside className="note" aria-labelledby="independence-heading">
            <h2 id="independence-heading">Closing this tab is safe</h2>
            <p>
              The execution worker is its own server process. It keeps running without a browser. Stopping the process,
              or shutting down this computer, stops it. Always-on operation needs hosting (P10).
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}
