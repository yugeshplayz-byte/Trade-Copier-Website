import type { Metadata } from 'next';
import { PlannedSection } from '@/components/PlannedSection.tsx';

export const metadata: Metadata = { title: 'Risk' };

export default function RiskPage() {
  return <PlannedSection href="/risk" />;
}
