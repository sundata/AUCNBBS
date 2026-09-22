import { setRequestLocale } from 'next-intl/server';
import { ListingBrowse } from '@/components/listing-browse';
import { AutoIntel } from '@/components/auto-intel';
import type { SearchParams } from '@/lib/server';
import { sectionMeta } from '@/lib/meta';

export const generateMetadata = sectionMeta('meta.services', '/services');

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="space-y-5">
      <ListingBrowse type="service" searchParams={searchParams} />
      <AutoIntel title="华人生活服务" category="service" />
    </div>
  );
}
