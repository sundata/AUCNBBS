import { setRequestLocale } from 'next-intl/server';
import { AdminPanel } from '@/components/admin-panel';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <AdminPanel />;
}
