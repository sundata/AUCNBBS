import type { ListingIntent, ListingType } from '@aucn/domain';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type ListingSummary, type Page } from '@/lib/api';
import { cityName, LISTING_ROUTES } from '@/lib/format';
import { first, resolveCity, type SearchParams } from '@/lib/server';
import { ListingCard } from './listing-card';
import { Empty } from './section';

export async function ListingBrowse({
  type,
  searchParams,
}: {
  type: ListingType;
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const city = await resolveCity(first(sp.city));
  const intentParam = first(sp.intent);
  const intent: ListingIntent | undefined =
    intentParam === 'offer' || intentParam === 'wanted' ? intentParam : undefined;
  const cursor = first(sp.cursor);
  const page = await api<Page<ListingSummary>>(
    `/listings${qs({ type, intent, cityId: city?.id, cursor })}`,
  );
  const t = await getTranslations('listing');
  const loc = (await getLocale()) as AppLocale;
  const route = `/${LISTING_ROUTES[type]}`;
  const base = { city: city?.slug };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-xl font-bold">
          {t(`type.${type}`)}
          {city && (
            <span className="text-muted font-normal text-base"> · {cityName(city, loc)}</span>
          )}
        </h1>
        <div className="flex gap-1 text-sm">
          {(['all', 'offer', 'wanted'] as const).map((v) => {
            const active = (v === 'all' && !intent) || v === intent;
            return (
              <Link
                key={v}
                href={`${route}${qs({ ...base, intent: v === 'all' ? undefined : v })}`}
                className={`px-3 py-1 rounded-full border ${active ? 'bg-brand text-white border-brand' : 'border-gray-300 hover:border-brand'}`}
              >
                {v === 'all' ? t('filterAll') : t(`intentLabel.${type}.${v}`)}
              </Link>
            );
          })}
        </div>
        <Link href={`/post${qs({ type })}`} className="ml-auto text-sm text-brand">
          + {t(`intentLabel.${type}.offer`)} / {t(`intentLabel.${type}.wanted`)}
        </Link>
      </div>
      <p className="text-xs text-muted mb-3">{t('safetyTip')}</p>
      {page.items.length === 0 ? (
        <Empty text={t('empty')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {page.items.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </div>
      )}
      {page.nextCursor && (
        <Link
          href={`${route}${qs({ ...base, intent, cursor: page.nextCursor })}`}
          className="block text-center text-sm text-brand mt-4"
        >
          {t('loadMore')}
        </Link>
      )}
    </div>
  );
}
