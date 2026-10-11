import { withAuth } from '@workos-inc/authkit-nextjs';
import type { Metadata } from 'next';
import { StatusBadge } from '@/components/StatusBadge.tsx';
import { DISPLAY_TIMEZONE } from '@/lib/format.ts';
import { displayNameOf } from '@/lib/server/auth.ts';
import { getServerConfig } from '@/lib/server-config.ts';
import { signOutAction } from '../actions.ts';

export const metadata: Metadata = { title: 'Settings' };

const LATER = [
  { item: 'Display timezone', note: `Shown in ${DISPLAY_TIMEZONE} (ET) for now.` },
  { item: 'Active sessions and sign-out everywhere', note: 'Planned with session revocation.' },
  { item: 'Data export and account deletion', note: 'Planned with the privacy and retention review.' },
];

export default async function SettingsPage() {
  const result = getServerConfig();
  if (!result.ok) return null;
  const authConfigured = result.config.auth.configured;
  const user = authConfigured ? (await withAuth()).user : null;

  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
      </header>

      <section className="section" aria-labelledby="account-heading">
        <div className="section__head">
          <h2 id="account-heading">Account</h2>
          {authConfigured && <span className="section__meta">WorkOS AuthKit · staging</span>}
        </div>
        {user ? (
          <>
            <dl className="meta-list meta-list--plain">
              <div>
                <dt>Name</dt>
                <dd>{displayNameOf(user) || 'Not set'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Multi-factor authentication</dt>
                <dd>
                  <StatusBadge tone="neutral">Policy enforced</StatusBadge> Required by the WorkOS sign-in policy. The app does not
                  yet verify it per session, so no live-trading feature relies on it.
                </dd>
              </div>
            </dl>
            <form action={signOutAction} className="settings__actions">
              <button type="submit" className="btn">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <p className="empty">Sign-in is not configured, so there is no account to show.</p>
        )}
      </section>

      <section className="section" aria-labelledby="later-heading">
        <div className="section__head">
          <h2 id="later-heading">Not built yet</h2>
        </div>
        <dl className="meta-list meta-list--plain">
          {LATER.map((l) => (
            <div key={l.item}>
              <dt>{l.item}</dt>
              <dd>{l.note}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
