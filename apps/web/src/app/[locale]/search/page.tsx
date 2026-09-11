import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type SearchResult } from '@/lib/api';
import { formatDate, LISTING_ROUTES } from '@/lib/format';
import { first, resolveCity, type SearchParams } from '@/lib/server';
import { Empty } from '@/components/section';

const SCOPES = ['all', 'listings', 'posts', 'articles'] as const;
type Scope = (typeof SCOPES)[number];

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const q = (first(sp.q) ?? '').trim();
  const scopeParam = first(sp.scope);
  const scope: Scope = SCOPES.includes(scopeParam as Scope) ? (scopeParam as Scope) : 'all';
  const city = await resolveCity(first(sp.city));
  const result = q
    ? await api<SearchResult>(
        `/search${qs({ q, scope: scope === 'all' ? undefined : scope, cityId: city?.id })}`,
      )
    : null;
  const t = await getTranslations('search');
  const loc = (await getLocale()) as AppLocale;

  const hrefFor = (h: SearchResult['hits'][number]) =>
    h.kind === 'listing' && h.listingType
      ? `/${LISTING_ROUTES[h.listingType]}/${h.id}`
      : h.kind === 'post'
        ? `/community/posts/${h.id}`
        : `/news/${h.slug ?? h.id}`;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-3">{t('title')}</h1>
      <form className="flex gap-2 mb-4">
        <input
          name="q"
          defaultValue={q}
          placeholder={t('placeholder')}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {city && <input type="hidden" name="city" value={city.slug} />}
        <button type="submit" className="rounded bg-brand text-white px-4 text-sm">
          {t('title')}
        </button>
      </form>
      <div className="flex gap-1 text-sm mb-4">
        {SCOPES.map((s) => (
          <Link
            key={s}
            href={`/search${qs({ q, scope: s === 'all' ? undefined : s, city: city?.slug })}`}
            className={`px-3 py-1 rounded-full border ${scope === s ? 'bg-brand text-white border-brand' : 'border-gray-300'}`}
          >
            {t(`scope.${s}`)}
          </Link>
        ))}
      </div>
      {result && (
        <p className="text-sm text-muted mb-2">{t('results', { q, count: result.total })}</p>
      )}
      {result && result.hits.length === 0 && <Empty text={t('empty')} />}
      <ul className="divide-y divide-gray-100">
        {result?.hits.map((h) => (
          <li key={`${h.kind}-${h.id}`} className="py-3">
            <Link href={hrefFor(h)} className="group block">
              <div className="text-xs text-muted flex gap-2">
                <span className="text-brand">{t(`kind.${h.kind}`)}</span>
                <span>{formatDate(h.createdAt, loc)}</span>
              </div>
              <div className="font-medium group-hover:text-brand">{h.title}</div>
              <p className="text-sm text-muted line-clamp-2">{h.snippet}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
