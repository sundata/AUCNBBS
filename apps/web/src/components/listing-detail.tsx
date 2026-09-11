import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { AppLocale } from '@/i18n/routing';
import { api, ApiError, type ListingDetail } from '@/lib/api';
import { cityName, formatDate, formatMoney } from '@/lib/format';
import { ListingPrice } from './listing-card';
import { OwnerActions } from './owner-actions';
import { ReportButton } from './report-button';

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex gap-3 text-sm py-1 border-b border-gray-100 last:border-0">
      <dt className="w-32 shrink-0 text-muted">{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

export async function ListingDetailView({ id }: { id: string }) {
  let l: ListingDetail;
  try {
    l = await api<ListingDetail>(`/listings/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.problem.status === 404 || e.problem.status === 400)) notFound();
    throw e;
  }
  const t = await getTranslations('listing');
  const th = await getTranslations('housing');
  const tj = await getTranslations('job');
  const ti = await getTranslations('item');
  const ts = await getTranslations('service');
  const tp = await getTranslations('post');
  const loc = (await getLocale()) as AppLocale;
  const d = l.details as Record<string, string | number | boolean | string[] | null>;
  const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <article className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-1.5 py-0.5 rounded ${l.intent === 'wanted' ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-brand'}`}
          >
            {t(`intentLabel.${l.type}.${l.intent}`)}
          </span>
          <span className="text-muted">
            {cityName(l.city, loc)}
            {l.suburb ? ` · ${l.suburb}` : ''}
          </span>
          {l.status !== 'active' && (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              {t(`status.${l.status}`)}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold mt-2">{l.title}</h1>
        <div className="mt-2 text-lg">
          <ListingPrice l={l} />
        </div>
        <div className="text-xs text-muted mt-1">
          {t('publishedAt')} {formatDate(l.publishedAt, loc)} · {t('expiresAt')}{' '}
          {formatDate(l.expiresAt, loc)} · {l.viewCount} {t('views')}
        </div>
        <div className="mt-6 whitespace-pre-wrap leading-7">{l.body}</div>

        <h2 className="mt-8 mb-2 font-semibold">{t('details')}</h2>
        <dl>
          {l.type === 'housing' && (
            <>
              <Row label={tp('kind')} value={th(`kind.${d.kind as 'whole'}`)} />
              <Row
                label={tp('propertyType')}
                value={tp(`propertyTypes.${d.propertyType as 'apartment'}`)}
              />
              <Row label={tp('bedrooms')} value={str(d.bedrooms)} />
              <Row label={tp('bathrooms')} value={str(d.bathrooms)} />
              <Row label={tp('parking')} value={str(d.parking)} />
              <Row label={th('bond')} value={formatMoney(d.bondMinor as number | null)} />
              <Row
                label={th('availableFrom')}
                value={d.availableFrom ? formatDate(String(d.availableFrom), loc) : null}
              />
              <Row
                label={th('minTerm', { weeks: Number(d.minTermWeeks ?? 0) })}
                value={d.minTermWeeks ? '✓' : null}
              />
              <Row label={th('furnished')} value={d.furnished ? '✓' : null} />
              <Row label={th('billsIncluded')} value={d.billsIncluded ? '✓' : null} />
              <Row label={th('petsAllowed')} value={d.petsAllowed ? '✓' : null} />
              <Row label={tp('postcode')} value={str(d.postcode)} />
            </>
          )}
          {l.type === 'job' && (
            <>
              <Row label={tj('company')} value={str(d.companyName)} />
              <Row
                label={tp('employmentType')}
                value={tj(`employmentType.${d.employmentType as 'full_time'}`)}
              />
              <Row label={tp('industry')} value={tp(`industries.${d.industry as 'it'}`)} />
              <Row label={tj('superIncluded')} value={d.superIncluded ? '✓' : null} />
              <Row label={tj('remote')} value={d.remote ? '✓' : null} />
              <Row label={tj('workRights')} value={str(d.workRightsRequired)} />
              <Row
                label={tj('applyDeadline')}
                value={d.applyDeadline ? formatDate(String(d.applyDeadline), loc) : null}
              />
            </>
          )}
          {l.type === 'item' && (
            <>
              <Row label={tp('category')} value={tp(`itemCategories.${d.category as 'other'}`)} />
              <Row label={tp('condition')} value={ti(`condition.${d.condition as 'new'}`)} />
              <Row label={tp('brand')} value={str(d.brand)} />
              <Row label={ti('quantity')} value={str(d.quantity)} />
              <Row
                label={tp('deliveryMethods')}
                value={
                  Array.isArray(d.deliveryMethods)
                    ? d.deliveryMethods.map((m) => ti(`delivery.${m as 'pickup'}`)).join(', ')
                    : null
                }
              />
              <Row label={ti('negotiable')} value={d.negotiable ? '✓' : null} />
            </>
          )}
          {l.type === 'service' && (
            <>
              <Row
                label={tp('category')}
                value={tp(`serviceCategories.${d.category as 'other'}`)}
              />
              <Row label={tp('priceMode')} value={ts(`priceMode.${d.priceMode as 'quote'}`)} />
              <Row label={ts('serviceArea')} value={str(d.serviceArea)} />
              <Row
                label={tp('isBusiness')}
                value={d.isBusiness ? ts('business') : ts('individual')}
              />
              <Row label={ts('abn')} value={str(d.abn)} />
            </>
          )}
        </dl>
        <div className="mt-6 flex items-center gap-4">
          <ReportButton subjectType="listing" subjectId={l.id} />
        </div>
      </article>
      <aside className="space-y-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm">
          <div className="text-xs text-muted">{t('postedBy')}</div>
          <div className="font-medium">{l.owner.displayName}</div>
          <div className="text-xs text-muted">
            {t('memberSince')} {formatDate(l.owner.memberSince, loc)}
          </div>
          <div className="mt-3 text-xs text-muted">{t('contact')}</div>
          <div>
            {l.contactPolicy === 'in_app'
              ? t('contactInApp')
              : l.contactPolicy === 'phone_on_request'
                ? t('contactPhone')
                : t('contactPublic')}
          </div>
          <OwnerActions listing={l} />
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
          {t('safetyTip')}
        </div>
      </aside>
    </div>
  );
}
