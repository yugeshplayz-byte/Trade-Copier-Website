'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { WorkerStatus } from '@/lib/worker-health.ts';
import { presentWorkerStatus, type WorkerStatusView } from '@/lib/worker-status-view.ts';
import { StatusBadge } from './StatusBadge.tsx';

const POLL_INTERVAL_MS = 5_000;

const WorkerStatusContext = createContext<WorkerStatusView>({ state: 'CHECKING' });

/**
 * Polls the server's worker-status endpoint. Display only: trading never depends
 * on this browser being open.
 */
export function WorkerStatusProvider({ initial, children }: { initial: WorkerStatus | null; children: ReactNode }) {
  const [view, setView] = useState<WorkerStatusView>(initial ?? { state: 'CHECKING' });

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/v1/system/worker-health', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { status: WorkerStatus };
        if (!cancelled) setView(body.status);
      } catch {
        if (!cancelled) setView({ state: 'STATUS_UNAVAILABLE', at: new Date().toISOString() });
      }
    };
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return <WorkerStatusContext.Provider value={view}>{children}</WorkerStatusContext.Provider>;
}

export function WorkerStatusBadge() {
  const { tone, label } = presentWorkerStatus(useContext(WorkerStatusContext));
  return (
    <span role="status" aria-live="polite">
      <StatusBadge tone={tone}>{label}</StatusBadge>
    </span>
  );
}

/** Value and caption for the worker cell of the Overview readout. */
export function WorkerStatusDetail() {
  const { tone, short, detail } = presentWorkerStatus(useContext(WorkerStatusContext));
  return (
    <>
      <span className="readout__value">
        <StatusBadge tone={tone}>{short}</StatusBadge>
      </span>
      <span className="readout__caption">{detail}</span>
    </>
  );
}
