import { setRequestLocale } from 'next-intl/server';
import { ListingDetailView } from '@/components/listing-detail';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ListingDetailView id={id} />;
}
