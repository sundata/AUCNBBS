import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type HomeFeed } from '@/lib/api';
import { cityName, formatDate } from '@/lib/format';
import { first, resolveCity, type SearchParams } from '@/lib/server';
import { ListingCard } from '@/components/listing-card';
import { AdSlot } from '@/components/ad-slot';
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
    <div className="space-y-5 sm:space-y-6">
      <Link
        href="/weekend"
        className="block rounded-2xl border border-line bg-white p-5 hover:border-brand"
      >
        <span className="text-sm text-brand">SYDNEY · WEEKENDS</span>
        <h2 className="mt-2 text-2xl font-semibold text-navy">
          {loc === 'zh' ? '悉尼这周末，去哪儿？ →' : 'Your Sydney weekend starts here →'}
        </h2>
        <p className="mt-2 text-muted">
          {loc === 'zh'
            ? '找免费、亲子和室内活动，收藏心仪去处。'
            : 'Find free, family-friendly and indoor events. Save your favourites.'}
        </p>
      </Link>
      <div className="relative overflow-hidden rounded-3xl bg-navy px-5 py-7 sm:px-8 sm:py-9 text-white shadow-[0_14px_36px_rgba(18,48,74,0.18)]">
        <div className="relative max-w-2xl">
          <p className="text-xs uppercase tracking-[0.18em] text-white/60 mb-2">AUCN Hub</p>
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">
            {city ? cityName(city, loc) : t('cityHint')}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-white/75">{t('tagline')}</p>
        </div>
      </div>
      <AdSlot placement="home" cityId={city?.id} label={t('sponsored')} />
      <div className="grid gap-5 lg:grid-cols-3">
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
