import type { Metadata } from 'next';
import { PlannedSection } from '@/components/PlannedSection.tsx';

export const metadata: Metadata = { title: 'Copiers' };

export default function CopiersPage() {
  return <PlannedSection href="/copiers" />;
}
