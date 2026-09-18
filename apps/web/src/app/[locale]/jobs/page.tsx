import { setRequestLocale } from 'next-intl/server';
import { ListingBrowse } from '@/components/listing-browse';
import { AutoIntel } from '@/components/auto-intel';
import type { SearchParams } from '@/lib/server';

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
      <AutoIntel
        title={locale === 'zh' ? '求职就业动态' : 'Jobs & career intel'}
        q="job|hiring|career|employment|wage|salary|worker|visa"
      />
    </div>
  );
}
