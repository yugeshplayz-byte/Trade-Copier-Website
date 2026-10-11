'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '@/lib/format.ts';
import type { Tone } from '@/lib/worker-status-view.ts';
import { StatusBadge } from './StatusBadge.tsx';

interface Account {
  id: string;
  providerAccountId: string;
  displayName: string;
  positions: { product: string; expiry: string; netQuantity: number }[];
  openOrders: number;
  snapshotCursor: string | null;
  snapshotAsOf: string | null;
}

interface Connection {
  id: string;
  label: string;
  state: string;
  stateReason: string | null;
  lastSnapshotAt: string | null;
  accounts: Account[];
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Connection[]; asOf: string };

const STATE_VIEW: Record<string, { tone: Tone; label: string }> = {
  READY: { tone: 'ok', label: 'Ready' },
  CREATED: { tone: 'info', label: 'Waiting for worker' },
  CONNECTING: { tone: 'info', label: 'Connecting' },
  SNAPSHOTTING: { tone: 'info', label: 'Reading accounts' },
  RECONNECTING: { tone: 'warn', label: 'Reconnecting' },
  AUTHENTICATING: { tone: 'info', label: 'Authenticating' },
  AUTH_REQUIRED: { tone: 'danger', label: 'Sign-in required' },
  DISCONNECTED: { tone: 'danger', label: 'Disconnected' },
  BLOCKED: { tone: 'danger', label: 'Blocked' },
};
const SETTLED = new Set(['READY', 'DISCONNECTED', 'BLOCKED', 'AUTH_REQUIRED']);

function positionsText(a: Account): string {
  const open = a.positions.filter((p) => p.netQuantity !== 0);
  if (open.length === 0) return 'Flat';
  return open.map((p) => `${p.netQuantity > 0 ? '+' : ''}${p.netQuantity} ${p.product} ${p.expiry}`).join(', ');
}

/** Lists the tenant's broker connections and lets the user add a simulated one. */
export function ConnectionsPanel() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Reused across retries of the same click so a retry can never create a second connection.
  const pendingKey = useRef<string | null>(null);

  const fetchConnections = useCallback(async (): Promise<Load> => {
    try {
      const res = await fetch('/api/v1/connections', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      return { kind: 'ready', items: body.items, asOf: body.asOf };
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : 'Could not load connections.' };
    }
  }, []);

  const refresh = useCallback(async () => setLoad(await fetchConnections()), [fetchConnections]);

  useEffect(() => {
    let active = true;
    fetchConnections().then((next) => {
      if (active) setLoad(next);
    });
    return () => {
      active = false;
    };
  }, [fetchConnections]);

  // Poll only while a connection is still being established.
  const busy = load.kind === 'ready' && load.items.some((c) => !SETTLED.has(c.state));
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(id);
  }, [busy, refresh]);

  async function addSimulated() {
    setAdding(true);
    setAddError(null);
    pendingKey.current ??= `conn-${crypto.randomUUID()}`;
    try {
      const count = load.kind === 'ready' ? load.items.length : 0;
      const res = await fetch('/api/v1/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': pendingKey.current },
        body: JSON.stringify({ provider: 'simulated', label: `Simulator ${count + 1}` }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      pendingKey.current = null;
      await refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'The request failed. Nothing was confirmed.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="connections">
      <div className="connections__bar">
        <button type="button" className="btn" onClick={addSimulated} disabled={adding}>
          {adding ? 'Requesting…' : 'Add simulated connection'}
        </button>
        <span className="muted connections__hint">Simulated broker only. Real providers are not approved.</span>
      </div>
      {addError && (
        <p className="form-error" role="alert">
          {addError}
        </p>
      )}

      {load.kind === 'loading' && <p className="empty">Loading connections…</p>}
      {load.kind === 'error' && (
        <p className="form-error" role="alert">
          Connections could not be loaded: {load.message}
        </p>
      )}
      {load.kind === 'ready' && load.items.length === 0 && (
        <p className="empty">No connections yet. Add a simulated connection to get three practice accounts.</p>
      )}

      {load.kind === 'ready' &&
        load.items.map((c) => {
          const view = STATE_VIEW[c.state] ?? { tone: 'neutral' as Tone, label: c.state };
          return (
            <article key={c.id} className="connection" aria-label={c.label}>
              <header className="connection__head">
                <h3>{c.label}</h3>
                <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                <span className="connection__meta">
                  SIMULATED{c.lastSnapshotAt ? ` · snapshot ${formatTime(c.lastSnapshotAt)}` : ''}
                </span>
              </header>
              {c.stateReason && <p className="muted connection__reason">{c.stateReason}</p>}
              {c.accounts.length > 0 ? (
                <div className="table-scroll" role="region" aria-label={`${c.label} accounts`} tabIndex={0}>
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Environment</th>
                        <th scope="col">Position</th>
                        <th scope="col">Open orders</th>
                        <th scope="col">Snapshot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.accounts.map((a) => (
                        <tr key={a.id}>
                          <th scope="row">
                            {a.displayName}
                            <span className="table__sub" translate="no">
                              {a.providerAccountId}
                            </span>
                          </th>
                          <td className="table__mono">SIMULATED</td>
                          <td>{positionsText(a)}</td>
                          <td className="table__mono">{a.openOrders}</td>
                          <td className="table__mono">
                            {a.snapshotAsOf ? `${formatTime(a.snapshotAsOf)} · #${a.snapshotCursor}` : 'Not yet read'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !SETTLED.has(c.state) && <p className="muted">The execution worker is establishing this connection…</p>
              )}
            </article>
          );
        })}
      {load.kind === 'ready' && <p className="muted connections__asof">Checked {formatTime(load.asOf)}</p>}
    </div>
  );
}
