import { getSection } from '@/lib/sections.ts';
import { StatusBadge } from './StatusBadge.tsx';

/** Honest placeholder for a section whose backend behaviour does not exist yet. */
export function PlannedSection({ href }: { href: string }) {
  const section = getSection(href);
  const planned = section.planned;
  if (!planned) throw new Error(`${href} is not a planned section`);
  return (
    <>
      <header className="page-header">
        <div className="page-header__row">
          <h1>{section.label}</h1>
          <StatusBadge tone="neutral">Not built</StatusBadge>
        </div>
        <p className="page-header__meta">Planned · {planned.deliveredIn}</p>
      </header>

      <div className="planned">
        <p className="planned__purpose">{planned.purpose}</p>
        <dl className="meta-list">
          <div>
            <dt>Depends on</dt>
            <dd>{planned.dependsOn}</dd>
          </div>
          <div>
            <dt>Data shown</dt>
            <dd>None. Nothing backs this section yet, so there is no sample or simulated data here.</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
