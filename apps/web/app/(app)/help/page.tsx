import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Help' };

const CONTROLS = [
  {
    term: 'Pause new entries',
    meaning:
      'Blocks new or larger follower positions and cancels copier-owned pending entries. Exits and protective orders keep working. An open position stays open and visible.',
  },
  {
    term: 'Emergency halt',
    meaning: 'Stops risk-increasing orders as soon as the request is durably recorded. It does not mean accounts are flat.',
  },
  {
    term: 'Flatten',
    meaning:
      'A separate, explicit liquidation of the follower accounts in scope. Each account reports its own result, and counts as flat only when the broker confirms it.',
  },
];

export default function HelpPage() {
  return (
    <>
      <header className="page-header">
        <h1>Help</h1>
      </header>

      <section className="section" aria-labelledby="controls-heading">
        <div className="section__head">
          <h2 id="controls-heading">Pause, halt and flatten are different</h2>
          <span className="section__meta">Arrives in P4–P5</span>
        </div>
        <dl className="glossary">
          {CONTROLS.map((c) => (
            <div key={c.term}>
              <dt>{c.term}</dt>
              <dd>{c.meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="section" aria-labelledby="local-heading">
        <div className="section__head">
          <h2 id="local-heading">Running locally</h2>
        </div>
        <p className="section__intro">
          Start the web app and worker together with <code translate="no">npm run dev</code>. They are separate
          processes, and the worker keeps running when this browser closes. The repository README covers setup.
        </p>
      </section>
    </>
  );
}
