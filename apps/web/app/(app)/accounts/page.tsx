import type { Metadata } from 'next';
import { PlannedSection } from '@/components/PlannedSection.tsx';

export const metadata: Metadata = { title: 'Accounts' };

export default function AccountsPage() {
  return <PlannedSection href="/accounts" />;
}
