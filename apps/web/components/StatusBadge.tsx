import type { ReactNode } from 'react';
import type { Tone } from '@/lib/worker-status-view.ts';

/** Square indicator plus text label. The label always carries the meaning; colour only reinforces it. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`indicator indicator--${tone}`}>{children}</span>;
}
