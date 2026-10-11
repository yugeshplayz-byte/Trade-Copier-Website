import type { Metadata } from 'next';
import { PlannedSection } from '@/components/PlannedSection.tsx';

export const metadata: Metadata = { title: 'Activity' };

export default function ActivityPage() {
  return <PlannedSection href="/activity" />;
}
