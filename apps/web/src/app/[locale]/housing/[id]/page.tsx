import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ListingDetailView } from '@/components/listing-detail';
import { listingMetadata } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  return listingMetadata((await params).id);
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ListingDetailView id={id} />;
}
