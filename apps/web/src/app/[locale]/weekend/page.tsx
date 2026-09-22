import { setRequestLocale } from 'next-intl/server';
import { WeekendGuide } from '@/components/weekend-guide';
import { sectionMeta } from '@/lib/meta';

export const generateMetadata = sectionMeta('meta.weekend', '/weekend');
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <WeekendGuide />;
}
