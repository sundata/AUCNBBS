import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { EVENT_CATEGORIES } from '@aucn/domain';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type EventSummary, type Page } from '@/lib/api';
import { cityName, formatDateTime, formatMoney } from '@/lib/format';

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('events');
  const loc = (await getLocale()) as AppLocale;
  const page = await api<Page<EventSummary>>(
    `/events${qs({ cityId: sp.city, category: sp.category, cursor: sp.cursor })}`,
  ).catch(() => ({ items: [], nextCursor: null }) as Page<EventSummary>);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Link href="/events/new" className="rounded-lg bg-coral text-white px-3 py-2 text-sm">
          {t('add')}
        </Link>
      </div>
      <form className="flex gap-2 text-sm" action={`/${locale}/events`}>
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="rounded border border-gray-300 px-3 py-1.5"
        >
          <option value="">{t('allCategories')}</option>
          {EVENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
        <button className="rounded bg-brand text-white px-4 py-1.5">{t('filter')}</button>
      </form>
      {page.items.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {page.items.map((e) => (
            <li key={e.id}>
              <Link
                href={`/events/${e.id}`}
                className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-brand"
              >
                <div className="text-xs text-muted">
                  {formatDateTime(e.startsAt, loc)} ·{' '}
                  {e.online ? t('online') : `${e.venue ?? cityName(e.city, loc)}`}
                </div>
                <h2 className="font-semibold line-clamp-2 mt-1">{e.title}</h2>
                <p className="text-xs text-muted mt-1">
                  {t(`category.${e.category as 'other'}`)} ·{' '}
                  {e.priceMinor ? formatMoney(e.priceMinor) : t('free')} ·{' '}
                  {t('going', { count: e.goingCount })}
                  {e.capacity ? `/${e.capacity}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <Link
          href={`/events?${new URLSearchParams({ ...(sp.category ? { category: sp.category } : {}), cursor: page.nextCursor }).toString()}`}
          className="text-brand underline text-sm"
        >
          {t('more')}
        </Link>
      )}
    </div>
  );
}
