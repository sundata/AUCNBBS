import { setRequestLocale } from 'next-intl/server';
import { BusinessForm } from '@/components/business-form';

export default async function NewBusinessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <BusinessForm />;
}
