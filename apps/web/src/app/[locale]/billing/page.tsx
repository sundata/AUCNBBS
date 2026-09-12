import { setRequestLocale } from 'next-intl/server';
import { BillingPanel } from '@/components/billing-panel';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <BillingPanel />;
}
