import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api, qs, type PulseFeedItem } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { first, resolveCity, type SearchParams } from '@/lib/server';
import { Empty } from '@/components/section';

const CATS = [
  'news',
  'deal',
  'event',
  'guide',
  'notice',
  'housing',
  'job',
  'market',
  'service',
] as const;

export default async function PulsePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('pulse');
  const city = await resolveCity(first(sp.city));
  const category = CATS.find((c) => c === first(sp.category));
  const page = Math.max(1, Number(first(sp.page) ?? 1) || 1);
  const feed = await api<{ items: PulseFeedItem[]; total: number; page: number }>(
    `/pulse/feed${qs({ category, city: city?.slug, page })}`,
  ).catch(() => ({ items: [], total: 0, page: 1 }));
  const pages = Math.max(1, Math.ceil(feed.total / 20));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label={t('categories')}>
        <Link
          href={`/pulse${qs({ city: city?.slug })}`}
          className={`rounded-full border px-3 py-1 text-sm ${!category ? 'border-brand bg-red-50 text-brand' : 'border-line'}`}
        >
          {t('catAll')}
        </Link>
        {CATS.map((c) => (
          <Link
            key={c}
            href={`/pulse${qs({ category: c, city: city?.slug })}`}
            className={`rounded-full border px-3 py-1 text-sm ${category === c ? 'border-brand bg-red-50 text-brand' : 'border-line'}`}
          >
            {t(`cat.${c}`)}
          </Link>
        ))}
      </nav>
      {feed.items.length === 0 ? (
        <Empty text={t('empty')} />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-line bg-white">
          {feed.items.map((item) => (
            <li key={item.id} className="p-4">
              <Link href={`/pulse/${item.id}`} className="group block">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="text-brand">{t(`cat.${item.category as 'news'}`)}</span>
                  <span>{item.sourceName}</span>
                  {item.location && <span>{item.location}</span>}
                  {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
                </div>
                <h3 className="mt-1 font-medium group-hover:text-brand">
                  {item.titleZh ?? item.title}
                </h3>
                {(item.summaryZh ?? item.summary) && (
                  <p className="mt-1 text-sm text-muted line-clamp-2">
                    {item.summaryZh ?? item.summary}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="flex justify-center gap-2 text-sm" aria-label="pagination">
          {Array.from({ length: Math.min(pages, 10) }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/pulse${qs({ category, city: city?.slug, page: p })}`}
              className={`rounded px-2 py-1 ${p === feed.page ? 'bg-red-50 text-brand' : 'hover:bg-gray-50'}`}
            >
              {p}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
