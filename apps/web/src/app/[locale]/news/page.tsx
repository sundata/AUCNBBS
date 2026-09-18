import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type ArticleSummary, type Page } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { first, type SearchParams } from '@/lib/server';
import { Empty } from '@/components/section';
import { AutoIntel } from '@/components/auto-intel';

export default async function NewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const page = await api<Page<ArticleSummary>>(
    `/articles${qs({ category: first(sp.category), cursor: first(sp.cursor) })}`,
  );
  const t = await getTranslations('news');
  const th = await getTranslations('home');
  const tl = await getTranslations('listing');
  const loc = (await getLocale()) as AppLocale;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h1 className="text-xl font-bold mb-4">{t('title')}</h1>
      {page.items.length === 0 ? (
        <Empty text={th('empty')} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {page.items.map((a) => (
            <li key={a.id} className="py-3">
              <Link href={`/news/${a.slug}`} className="group block">
                <div className="text-xs text-muted flex gap-2">
                  <span className="text-brand">{t(`category.${a.category as 'platform'}`)}</span>
                  <span>{formatDate(a.publishedAt, loc)}</span>
                </div>
                <h2 className="font-semibold group-hover:text-brand">{a.title}</h2>
                <p className="text-sm text-muted line-clamp-2">{a.summary}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <Link
          href={`/news${qs({ category: first(sp.category), cursor: page.nextCursor })}`}
          className="block text-center text-sm text-brand mt-4"
        >
          {tl('loadMore')}
        </Link>
      )}
      <AutoIntel title={loc === 'zh' ? '本地媒体速览' : 'Local media roundup'} category="news" />
    </div>
  );
}
