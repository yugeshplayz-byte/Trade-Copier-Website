'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export interface NavItem {
  href: string;
  label: string;
  /** Roadmap phase tag for sections not built yet. */
  phaseTag: string | null;
}

/** Left rail on wide screens; a disclosure menu on narrow screens. */
export function PrimaryNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const current = items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  // Close the narrow-screen menu after navigation.
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const groups = [
    { label: 'Workspace', items: items.filter((i) => i.phaseTag === null) },
    { label: 'Later phases', items: items.filter((i) => i.phaseTag !== null) },
  ];

  return (
    <div className="nav-area">
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="primary-nav"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Menu</span>
        <span className="nav-toggle__current">{current?.label ?? ''}</span>
        <span aria-hidden="true" className={open ? 'nav-toggle__mark nav-toggle__mark--open' : 'nav-toggle__mark'} />
      </button>
      <nav id="primary-nav" aria-label="Primary" className={open ? 'rail rail--open' : 'rail'}>
        {groups.map((group) => (
          <div key={group.label} className="rail__group">
            <p className="rail__heading">{group.label}</p>
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={item === current ? 'page' : undefined}
                    className={item.phaseTag ? 'rail__link rail__link--planned' : 'rail__link'}
                  >
                    <span>{item.label}</span>
                    {item.phaseTag && (
                      <span className="rail__tag">
                        <span className="sr-only">Planned for phase </span>
                        {item.phaseTag}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
