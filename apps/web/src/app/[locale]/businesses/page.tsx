import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { BUSINESS_CATEGORIES } from '@aucn/domain';
import { Link } from '@/i18n/routing';
import { api, qs, type BusinessSummary, type Page } from '@/lib/api';
import { cityName } from '@/lib/format';
import { AutoIntel } from '@/components/auto-intel';
import { sectionMeta } from '@/lib/meta';

export const generateMetadata = sectionMeta('meta.businesses', '/businesses');

export default async function BusinessesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('businesses');
  const page = await api<Page<BusinessSummary>>(
    `/businesses${qs({ cityId: sp.city, category: sp.category, q: sp.q, cursor: sp.cursor })}`,
  ).catch(() => ({ items: [], nextCursor: null }) as Page<BusinessSummary>);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Link href="/businesses/new" className="rounded-lg bg-coral text-white px-3 py-2 text-sm">
          {t('add')}
        </Link>
      </div>
      <form className="flex flex-wrap gap-2 text-sm" action={`/${locale}/businesses`}>
        <input
          name="q"
          defaultValue={sp.q}
          placeholder={t('searchPlaceholder')}
          className="rounded border border-gray-300 px-3 py-1.5"
        />
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="rounded border border-gray-300 px-3 py-1.5"
        >
          <option value="">{t('allCategories')}</option>
          {BUSINESS_CATEGORIES.map((c) => (
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
          {page.items.map((b) => (
            <li key={b.id}>
              <Link
                href={`/businesses/${b.id}`}
                className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-brand"
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold line-clamp-1">{b.nameZh}</h2>
                  {b.claimed && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                      {t('claimed')}
                    </span>
                  )}
                </div>
                {b.nameEn && <p className="text-sm text-muted line-clamp-1">{b.nameEn}</p>}
                <p className="text-xs text-muted mt-1">
                  {t(`category.${b.category as 'other'}`)} · {b.suburb}
                  {b.city ? ` · ${cityName(b.city)}` : ''}
                </p>
                <p className="text-xs text-muted mt-1">{t('reviews', { count: b.reviewCount })}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <Link
          href={`/businesses?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.category ? { category: sp.category } : {}), cursor: page.nextCursor }).toString()}`}
          className="text-brand underline text-sm"
        >
          {t('more')}
        </Link>
      )}
      <AutoIntel
        title="商家优惠与本地商机"
        category="deal"
      />
    </div>
  );
}
