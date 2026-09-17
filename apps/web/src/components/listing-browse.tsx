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
  const suburb = first(sp.suburb);
  const bedrooms = first(sp.bedrooms);
  const sort = first(sp.sort);
  const priceMinAud = first(sp.priceMin);
  const priceMaxAud = first(sp.priceMax);
  // W-7: server-side filter params; prices entered in dollars, API takes minor units.
  const page = await api<Page<ListingSummary>>(
    `/listings${qs({
      type,
      intent,
      cityId: city?.id,
      cursor,
      suburb,
      bedrooms: type === 'housing' ? bedrooms : undefined,
      sort: sort === 'price_asc' || sort === 'price_desc' ? sort : undefined,
      priceMin: priceMinAud ? Number(priceMinAud) * 100 : undefined,
      priceMax: priceMaxAud ? Number(priceMaxAud) * 100 : undefined,
    })}`,
  );
  const t = await getTranslations('listing');
  const loc = (await getLocale()) as AppLocale;
  const route = `/${LISTING_ROUTES[type]}`;
  const filterParams = {
    city: city?.slug,
    intent,
    suburb,
    bedrooms: type === 'housing' ? bedrooms : undefined,
    sort,
    priceMin: priceMinAud,
    priceMax: priceMaxAud,
  };

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
                href={`${route}${qs({ ...filterParams, intent: v === 'all' ? undefined : v })}`}
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
      <form method="get" action={route} className="flex flex-wrap gap-2 mb-3 text-sm items-end">
        {city && <input type="hidden" name="city" value={city.slug} />}
        {intent && <input type="hidden" name="intent" value={intent} />}
        <label className="flex flex-col">
          <span className="text-xs text-muted">{t('priceMin')}</span>
          <input
            name="priceMin"
            type="number"
            min={0}
            defaultValue={priceMinAud}
            className="border rounded px-2 py-1 w-24"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted">{t('priceMax')}</span>
          <input
            name="priceMax"
            type="number"
            min={0}
            defaultValue={priceMaxAud}
            className="border rounded px-2 py-1 w-24"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted">{t('suburb')}</span>
          <input name="suburb" defaultValue={suburb} className="border rounded px-2 py-1 w-32" />
        </label>
        {type === 'housing' && (
          <label className="flex flex-col">
            <span className="text-xs text-muted">{t('bedrooms')}</span>
            <input
              name="bedrooms"
              type="number"
              min={0}
              max={10}
              defaultValue={bedrooms}
              className="border rounded px-2 py-1 w-16"
            />
          </label>
        )}
        <label className="flex flex-col">
          <span className="text-xs text-muted">{t('sort')}</span>
          <select name="sort" defaultValue={sort ?? 'latest'} className="border rounded px-2 py-1">
            <option value="latest">{t('sortLatest')}</option>
            <option value="price_asc">{t('sortPriceAsc')}</option>
            <option value="price_desc">{t('sortPriceDesc')}</option>
          </select>
        </label>
        <button className="bg-brand text-white rounded px-3 py-1">{t('apply')}</button>
      </form>
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
          href={`${route}${qs({ ...filterParams, cursor: page.nextCursor })}`}
          className="block text-center text-sm text-brand mt-4"
        >
          {t('loadMore')}
        </Link>
      )}
    </div>
  );
}
