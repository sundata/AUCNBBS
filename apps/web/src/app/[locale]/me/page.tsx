import { setRequestLocale } from 'next-intl/server';
import { MePanel } from '@/components/me-panel';

export default async function MePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MePanel />;
}
