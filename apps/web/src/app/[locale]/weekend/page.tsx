import { setRequestLocale } from 'next-intl/server';
import { WeekendGuide } from '@/components/weekend-guide';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <WeekendGuide />;
}
