import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type HomeFeed } from '@/lib/api';
import { cityName, formatDate } from '@/lib/format';
import { first, resolveCity, type SearchParams } from '@/lib/server';
import { ListingCard } from '@/components/listing-card';
import { Empty, Section } from '@/components/section';

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const city = await resolveCity(first(sp.city));
  const feed = await api<HomeFeed>(`/feed/home${qs({ cityId: city?.id })}`);
  const t = await getTranslations('home');
  const tn = await getTranslations('news');
  const tc = await getTranslations('community');
  const loc = (await getLocale()) as AppLocale;
  const citySuffix = city ? qs({ city: city.slug }) : '';

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{city ? cityName(city, loc) : t('cityHint')}</h1>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title={t('headlines')} href="/news" more={t('more')}>
            {feed.headlines.length === 0 ? (
              <Empty text={t('empty')} />
            ) : (
              <ul className="divide-y divide-gray-100">
                {feed.headlines.map((a, i) => (
                  <li key={a.id} className="py-2">
                    <Link href={`/news/${a.slug}`} className="group block">
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <span className="text-brand">
                          {tn(`category.${a.category as 'platform'}`)}
                        </span>
                        <span>{formatDate(a.publishedAt, loc)}</span>
                      </div>
                      <h3
                        className={`group-hover:text-brand ${i === 0 ? 'text-lg font-semibold' : 'font-medium'}`}
                      >
                        {a.title}
                      </h3>
                      {i === 0 && (
                        <p className="text-sm text-muted mt-1 line-clamp-2">{a.summary}</p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <Section title={t('hotPosts')} href="/community" more={t('more')}>
          {feed.hotPosts.length === 0 ? (
            <Empty text={t('empty')} />
          ) : (
            <ul className="space-y-2 text-sm">
              {feed.hotPosts.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <Link href={`/community/posts/${p.id}`} className="hover:text-brand line-clamp-1">
                    {p.title}
                  </Link>
                  <span className="text-xs text-muted shrink-0">
                    {tc('comments', { count: p.commentCount })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ['housing', 'housing', t('housing')],
            ['job', 'jobs', t('jobs')],
            ['item', 'market', t('market')],
            ['service', 'services', t('services')],
          ] as const
        ).map(([type, route, title]) => (
          <Section key={type} title={title} href={`/${route}${citySuffix}`} more={t('more')}>
            {feed.listings[type].length === 0 ? (
              <Empty text={t('empty')} />
            ) : (
              <div className="space-y-2">
                {feed.listings[type].map((l) => (
                  <ListingCard key={l.id} l={l} compact />
                ))}
              </div>
            )}
          </Section>
        ))}
      </div>
    </div>
  );
}
