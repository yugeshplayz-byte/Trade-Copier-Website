import type { Metadata } from 'next';
import { PlannedSection } from '@/components/PlannedSection.tsx';

export const metadata: Metadata = { title: 'Billing' };

export default function BillingPage() {
  return <PlannedSection href="/billing" />;
}
