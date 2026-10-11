import type { Metadata } from 'next';
import { PlannedSection } from '@/components/PlannedSection.tsx';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return <PlannedSection href="/settings" />;
}
