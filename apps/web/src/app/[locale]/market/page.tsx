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
      <ListingBrowse type="item" searchParams={searchParams} />
      <AutoIntel
        title={locale === 'zh' ? '折扣与二手情报' : 'Deals & secondhand intel'}
        category="deal"
      />
    </div>
  );
}
