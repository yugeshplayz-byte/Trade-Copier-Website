'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sizingPreview } from '@tradecopier/domain';
import type { Tone } from '@/lib/worker-status-view.ts';
import { StatusBadge } from './StatusBadge.tsx';

interface AccountOption {
  id: string;
  label: string;
  ready: boolean;
}

interface Group {
  id: string;
  name: string;
  desiredState: string;
  stateReason: string | null;
  currentVersion: number;
  activeVersion: number | null;
  config: {
    leaderAccountId: string;
    followers: { accountId: string; numerator: number; denominator: number; maxAbsPosition: number; maxOrderQuantity: number }[];
  };
}

const RATIOS = [
  { label: '0.5x', numerator: 1, denominator: 2 },
  { label: '1x', numerator: 1, denominator: 1 },
  { label: '2x', numerator: 2, denominator: 1 },
  { label: '3x', numerator: 3, denominator: 1 },
];

const STATE_VIEW: Record<string, { tone: Tone; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  ARMING: { tone: 'info', label: 'Running activation checks' },
  ACTIVE: { tone: 'ok', label: 'Active' },
  PAUSED: { tone: 'warn', label: 'Paused' },
  HALTED: { tone: 'danger', label: 'Halted' },
  DISABLED: { tone: 'neutral', label: 'Disabled' },
};

interface FollowerDraft {
  enabled: boolean;
  ratio: string;
  maxAbsPosition: number;
  maxOrderQuantity: number;
}

async function postJson(url: string, body: unknown, key: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const problems: string[] = data?.error?.problems ?? [];
    throw new Error([data?.error?.message ?? `HTTP ${res.status}`, ...problems].join(' '));
  }
  return data;
}

/** Copier list, creation form and activation requests (simulated accounts only). */
export function CopiersPanel() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('My copier');
  const [leaderId, setLeaderId] = useState('');
  const [followers, setFollowers] = useState<Record<string, FollowerDraft>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const createKey = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [g, c] = await Promise.all([
        fetch('/api/v1/copier-groups', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/v1/connections', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (!Array.isArray(g.items) || !Array.isArray(c.items)) throw new Error(g?.error?.message ?? c?.error?.message ?? 'Unexpected response.');
      const options: AccountOption[] = c.items.flatMap((conn: { label: string; state: string; accounts: { id: string; displayName: string }[] }) =>
        conn.accounts.map((a) => ({ id: a.id, label: `${a.displayName} · ${conn.label}`, ready: conn.state === 'READY' })),
      );
      return { groups: g.items as Group[], options, error: null };
    } catch (err) {
      return { groups: null, options: [], error: err instanceof Error ? err.message : 'Could not load copiers.' };
    }
  }, []);

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchAll>>) => {
    setLoadError(r.error);
    if (r.groups) setGroups(r.groups);
    setAccounts(r.options);
  }, []);

  const refresh = useCallback(async () => apply(await fetchAll()), [apply, fetchAll]);

  useEffect(() => {
    let active = true;
    fetchAll().then((r) => {
      if (active) apply(r);
    });
    return () => {
      active = false;
    };
  }, [apply, fetchAll]);

  const arming = groups?.some((g) => g.desiredState === 'ARMING') ?? false;
  useEffect(() => {
    if (!arming) return;
    const id = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(id);
  }, [arming, refresh]);

  const labelOf = useMemo(() => new Map(accounts.map((a) => [a.id, a.label])), [accounts]);
  const readyAccounts = accounts.filter((a) => a.ready);
  const draftFollower = (id: string): FollowerDraft => followers[id] ?? { enabled: false, ratio: '1x', maxAbsPosition: 4, maxOrderQuantity: 2 };
  const setFollower = (id: string, patch: Partial<FollowerDraft>) => setFollowers((prev) => ({ ...prev, [id]: { ...draftFollower(id), ...patch } }));

  async function createCopier(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    createKey.current ??= `grp-${crypto.randomUUID()}`;
    try {
      const chosen = Object.entries(followers).filter(([id, f]) => f.enabled && id !== leaderId);
      await postJson(
        '/api/v1/copier-groups',
        {
          name,
          leaderAccountId: leaderId,
          followers: chosen.map(([accountId, f]) => {
            const r = RATIOS.find((x) => x.label === f.ratio) ?? RATIOS[1]!;
            return { accountId, numerator: r.numerator, denominator: r.denominator, maxAbsPosition: f.maxAbsPosition, maxOrderQuantity: f.maxOrderQuantity };
          }),
        },
        createKey.current,
      );
      createKey.current = null;
      setFollowers({});
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'The copier was not created.');
    } finally {
      setBusy(false);
    }
  }

  async function activate(group: Group) {
    setFormError(null);
    try {
      await postJson(`/api/v1/copier-groups/${group.id}/activate`, { expectedVersion: group.currentVersion }, `act-${crypto.randomUUID()}`);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Activation was not requested.');
    }
  }

  if (loadError && !groups) return <p className="form-error" role="alert">Copiers could not be loaded: {loadError}</p>;
  if (!groups) return <p className="empty">Loading copiers…</p>;

  return (
    <div className="copiers">
      {groups.length === 0 ? (
        <p className="empty">No copiers yet. Create one below from your simulated accounts.</p>
      ) : (
        groups.map((g) => {
          const view = STATE_VIEW[g.desiredState] ?? { tone: 'neutral' as Tone, label: g.desiredState };
          return (
            <article key={g.id} className="connection" aria-label={g.name}>
              <header className="connection__head">
                <h3>{g.name}</h3>
                <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                <span className="connection__meta">
                  EXECUTION · settings v{g.currentVersion}
                  {g.activeVersion ? ` · active v${g.activeVersion}` : ''}
                </span>
                {g.desiredState === 'DRAFT' && (
                  <button type="button" className="btn" onClick={() => activate(g)}>
                    Activate
                  </button>
                )}
              </header>
              {g.stateReason && <p className={g.desiredState === 'DRAFT' ? 'form-error' : 'muted'}>{g.stateReason}</p>}
              <dl className="meta-list meta-list--plain copier__members">
                <div>
                  <dt>Leader</dt>
                  <dd>{labelOf.get(g.config.leaderAccountId) ?? 'Unknown account'}</dd>
                </div>
                {g.config.followers.map((f) => (
                  <div key={f.accountId}>
                    <dt>Follower</dt>
                    <dd>
                      {labelOf.get(f.accountId) ?? 'Unknown account'} · {f.numerator}/{f.denominator} of the leader position · cap {f.maxAbsPosition}, max order{' '}
                      {f.maxOrderQuantity}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })
      )}

      <form className="copier-form" onSubmit={createCopier} aria-labelledby="new-copier-heading">
        <h3 id="new-copier-heading">New copier</h3>
        {readyAccounts.length < 2 ? (
          <p className="empty">You need a ready simulated connection first. Add one on the Connections page.</p>
        ) : (
          <>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </label>
            <label className="field">
              <span>Leader account</span>
              <select value={leaderId} onChange={(e) => setLeaderId(e.target.value)} required>
                <option value="">Choose the account you trade</option>
                {readyAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="field">
              <legend>Followers</legend>
              {readyAccounts
                .filter((a) => a.id !== leaderId)
                .map((a) => {
                  const f = draftFollower(a.id);
                  const ratio = RATIOS.find((r) => r.label === f.ratio) ?? RATIOS[1]!;
                  const preview = sizingPreview(ratio, [1, 2, 3]);
                  return (
                    <div key={a.id} className="follower-row">
                      <label className="follower-row__pick">
                        <input type="checkbox" checked={f.enabled} onChange={(e) => setFollower(a.id, { enabled: e.target.checked })} />
                        <span>{a.label}</span>
                      </label>
                      {f.enabled && (
                        <div className="follower-row__settings">
                          <label>
                            Size
                            <select value={f.ratio} onChange={(e) => setFollower(a.id, { ratio: e.target.value })}>
                              {RATIOS.map((r) => (
                                <option key={r.label}>{r.label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Position cap
                            <input type="number" min={1} max={100} value={f.maxAbsPosition} onChange={(e) => setFollower(a.id, { maxAbsPosition: Number(e.target.value) })} />
                          </label>
                          <label>
                            Max order
                            <input type="number" min={1} max={100} value={f.maxOrderQuantity} onChange={(e) => setFollower(a.id, { maxOrderQuantity: Number(e.target.value) })} />
                          </label>
                          <span className="follower-row__preview">
                            Leader 1/2/3 → follower {preview.map((p) => p.follower).join('/')}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </fieldset>
            <p className="muted copier-form__note">
              Copies confirmed leader fills (EXECUTION mode) with market orders, rounding sizes down. Activation requires every account to be
              flat with no working orders; existing positions are never adopted.
            </p>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Creating…' : 'Create copier'}
            </button>
          </>
        )}
      </form>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
    </div>
  );
}
