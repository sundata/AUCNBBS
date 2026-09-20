import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api, qs, type HomeFeed } from '@/lib/api';
import { cityName, formatDate } from '@/lib/format';
import { first, resolveCity, type SearchParams } from '@/lib/server';
import { ListingCard } from '@/components/listing-card';
import { AdSlot } from '@/components/ad-slot';
import { PulseDashboard } from '@/components/pulse-dashboard';
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
  const citySuffix = city ? qs({ city: city.slug }) : '';

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link
        href="/weekend"
        className="block rounded-2xl border border-line bg-white p-5 hover:border-brand"
      >
        <span className="text-sm text-brand">SYDNEY · WEEKENDS</span>
        <h2 className="mt-2 text-2xl font-semibold text-navy">
          悉尼这周末，去哪儿？ →
        </h2>
        <p className="mt-2 text-muted">{'找免费、亲子和室内活动，收藏心仪去处。'}</p>
      </Link>
      <div className="relative overflow-hidden rounded-3xl bg-navy px-5 py-7 sm:px-8 sm:py-9 text-white shadow-[0_14px_36px_rgba(18,48,74,0.18)]">
        <div className="relative max-w-2xl">
          <p className="text-xs uppercase tracking-[0.18em] text-white/60 mb-2">AUCN Hub</p>
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">
            {city ? cityName(city) : t('cityHint')}
          </h1>
          <p className="mt-2 text-sm sm:text-base text-white/75">{t('tagline')}</p>
        </div>
      </div>
      {feed.features.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg text-navy">今日画报</h2>
            <Link href="/news" className="text-sm text-brand">
              {t('more')}
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {feed.features.map((a, i) => (
              <Link
                key={a.id}
                href={`/news/${a.slug}`}
                className={`group relative overflow-hidden rounded-2xl aspect-[2/1] ${i === 0 ? 'sm:col-span-2' : ''}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.coverUrl ?? ''}
                  alt={a.title}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="absolute inset-0 w-full h-full object-cover transition duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-0 p-4">
                  <h3 className="text-white font-semibold text-lg leading-snug drop-shadow">
                    {a.title}
                  </h3>
                  <p className="text-white/70 text-sm line-clamp-1 mt-1">{a.summary}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      <AdSlot placement="home" cityId={city?.id} label={t('sponsored')} />
      <PulseDashboard citySlug={city?.slug} />
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
                        <span>{formatDate(a.publishedAt)}</span>
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
