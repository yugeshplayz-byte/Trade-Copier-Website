'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { signOutAction } from '@/app/(app)/actions.ts';

export function initialsOf(name: string): string {
  const letters = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  return letters || '?';
}

/** Compact account control: initials button that discloses name, Settings and Sign out. */
export function AccountMenu({ name, email }: { name: string; email: string | null }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (container.current && !container.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={container}>
      <button
        ref={button}
        type="button"
        className="account__button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {initialsOf(name)}
      </button>
      {open && (
        <div id={menuId} className="account__menu">
          <div className="account__identity">
            <p className="account__name">{name}</p>
            {email && <p className="account__email">{email}</p>}
          </div>
          <Link href="/settings" className="account__item" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="account__item">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
