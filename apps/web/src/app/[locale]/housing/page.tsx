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
      <ListingBrowse type="housing" searchParams={searchParams} />
      <AutoIntel
        title={locale === 'zh' ? '租房楼市动态' : 'Housing & rental intel'}
        q="rent|housing|property|apartment|flat|landlord|lease|mortgage"
      />
    </div>
  );
}
