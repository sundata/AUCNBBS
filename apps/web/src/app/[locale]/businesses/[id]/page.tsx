import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { api, ApiError, type BusinessDetail, type BusinessReviewDto, type Page } from '@/lib/api';
import { cityName } from '@/lib/format';
import { ClaimForm } from '@/components/business-panels';
import { FavoriteButton } from '@/components/favorite-button';
import { ReportButton } from '@/components/report-button';
import { ReviewsList } from '@/components/business-reviews';
import { LeadForm, LeadsInbox } from '@/components/business-extras';
import { MapLink } from '@/components/map-embed';
import { serverToken } from '@/lib/server-auth';
import { localeAlternates } from '@/lib/site';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const b = await api<BusinessDetail>(`/businesses/${id}`).catch(() => null);
  if (!b) return {};
  return {
    title: b.nameZh,
    description: b.descriptionZh?.slice(0, 140),
    alternates: localeAlternates(`/businesses/${id}`),
    openGraph: { title: b.nameZh, description: b.descriptionZh?.slice(0, 140) },
  };
}

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  let b: BusinessDetail;
  try {
    b = await api<BusinessDetail>(`/businesses/${id}`, { token: await serverToken() });
  } catch (e) {
    if (e instanceof ApiError && (e.problem.status === 404 || e.problem.status === 400)) notFound();
    throw e;
  }
  const reviews = await api<Page<BusinessReviewDto>>(`/businesses/${id}/reviews`).catch(
    () => ({ items: [], nextCursor: null }) as Page<BusinessReviewDto>,
  );
  const t = await getTranslations('businesses');
  const description = b.descriptionZh;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <article className="bg-white rounded-lg border border-gray-200 p-6 space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="px-1.5 py-0.5 rounded bg-gray-100">
            {t(`category.${b.category as 'other'}`)}
          </span>
          {b.claimed && (
            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700">{t('claimed')}</span>
          )}
          {b.status !== 'active' && (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{b.status}</span>
          )}
        </div>
        <h1 className="text-2xl font-bold">{b.nameZh}</h1>
        {b.nameEn && <p className="text-muted">{b.nameEn}</p>}
        {b.ratingAvg !== null && (
          <p className="text-sm">
            {'★'.repeat(Math.round(b.ratingAvg))} {b.ratingAvg.toFixed(1)} ·{' '}
            {t('reviews', { count: b.reviewCount })}
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap leading-7">{description}</p>
        <dl className="text-sm space-y-1 border-t pt-3">
          <div className="flex gap-3">
            <dt className="w-28 text-muted">{t('location')}</dt>
            <dd>
              {b.suburb}
              {b.city ? `, ${cityName(b.city)}` : ''}
              {b.address ? ` · ${b.address}` : ''}{' '}
              <MapLink
                query={`${b.address ?? ''} ${b.suburb}${b.city ? `, ${cityName(b.city)}` : ''}, Australia`.trim()}
              />
            </dd>
          </div>
          {b.openingHours && (
            <div className="flex gap-3">
              <dt className="w-28 text-muted">{t('hours')}</dt>
              <dd>{b.openingHours}</dd>
            </div>
          )}
          {b.priceRange && (
            <div className="flex gap-3">
              <dt className="w-28 text-muted">{t('priceRange')}</dt>
              <dd>{b.priceRange}</dd>
            </div>
          )}
          {b.phone && (
            <div className="flex gap-3">
              <dt className="w-28 text-muted">{t('phone')}</dt>
              <dd>{b.phone}</dd>
            </div>
          )}
          {b.website && (
            <div className="flex gap-3">
              <dt className="w-28 text-muted">{t('website')}</dt>
              <dd>
                <a href={b.website} className="text-brand underline" rel="noopener noreferrer">
                  {b.website}
                </a>
              </dd>
            </div>
          )}
        </dl>
        <div className="flex items-center gap-4 border-t pt-3">
          <FavoriteButton subjectType="business" subjectId={b.id} />
          <ReportButton subjectType="business" subjectId={b.id} />
          {!b.claimed && <ClaimForm businessId={b.id} />}
          <LeadForm businessId={b.id} />
        </div>
      </article>
      {b.locations.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold mb-3">{t('locations')}</h2>
          <ul className="text-sm divide-y">
            {b.locations.map((loc) => (
              <li key={loc.id} className="py-2">
                <strong>
                  {loc.label || t('location')}
                  {loc.isPrimary && <span className="text-xs text-brand ml-1">{t('primary')}</span>}
                </strong>
                <p className="text-muted">
                  {loc.suburb}
                  {loc.address ? ` · ${loc.address}` : ''}
                  {loc.phone ? ` · ${loc.phone}` : ''}{' '}
                  <MapLink query={`${loc.address ?? ''} ${loc.suburb}, Australia`.trim()} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {b.offers.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold mb-3">{t('offers')}</h2>
          <ul className="text-sm divide-y">
            {b.offers.map((o) => (
              <li key={o.id} className="py-2">
                <strong>{o.title}</strong>
                <span className="text-xs text-muted ml-2">
                  {t('offerEnds', { date: new Date(o.endsAt).toLocaleDateString() })}
                </span>
                {o.body && <p className="text-muted">{o.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {b.viewerIsOwner && <LeadsInbox businessId={b.id} />}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-3">{t('reviews', { count: b.reviewCount })}</h2>
        <ReviewsList businessId={b.id} initial={reviews.items} viewerIsOwner={b.viewerIsOwner} />
      </section>
    </div>
  );
}
