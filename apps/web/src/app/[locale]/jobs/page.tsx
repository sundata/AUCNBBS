import { setRequestLocale } from 'next-intl/server';
import { ListingBrowse } from '@/components/listing-browse';
import { AutoIntel } from '@/components/auto-intel';
import type { SearchParams } from '@/lib/server';
import { sectionMeta } from '@/lib/meta';

export const generateMetadata = sectionMeta('meta.jobs', '/jobs');

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
      <ListingBrowse type="job" searchParams={searchParams} />
      <AutoIntel title="华人招工求职" category="job" />
    </div>
  );
}
