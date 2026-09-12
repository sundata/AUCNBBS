import { useLocale, useTranslations } from 'next-intl';
import { Link, type AppLocale } from '@/i18n/routing';
import type { ListingSummary } from '@/lib/api';
import { cityName, formatDate, formatMoney, LISTING_ROUTES } from '@/lib/format';

export function priceSuffix(
  l: ListingSummary,
  t: ReturnType<typeof useTranslations<'listing'>>,
): string {
  const h = l.highlights;
  if (l.type === 'housing') {
    return h.rentPeriod === 'week'
      ? t('perWeek')
      : h.rentPeriod === 'fortnight'
        ? t('perFortnight')
        : t('perMonth');
  }
  if (l.type === 'job') {
    return h.salaryPeriod === 'hour'
      ? t('perHour')
      : h.salaryPeriod === 'year'
        ? t('perYear')
        : h.salaryPeriod === 'day'
          ? t('perDay')
          : h.salaryPeriod === 'week'
            ? t('perWeek')
            : '';
  }
  return '';
}

export function ListingPrice({ l }: { l: ListingSummary }) {
  const t = useTranslations('listing');
  const ts = useTranslations('service');
  if (l.type === 'job') {
    const min = formatMoney(l.highlights.salaryMinMinor as number | null);
    const max = formatMoney(l.highlights.salaryMaxMinor as number | null);
    if (!min && !max) return <span className="text-muted">{t('priceNegotiable')}</span>;
    return (
      <span className="text-brand font-semibold">
        {[min, max].filter(Boolean).join(' – ')}
        <span className="text-xs text-muted font-normal">{priceSuffix(l, t)}</span>
      </span>
    );
  }
  const price = formatMoney(l.priceMinor, l.currency);
  if (!price) return <span className="text-muted text-sm">{t('priceNegotiable')}</span>;
  return (
    <span className="text-brand font-semibold">
      {l.type === 'service' && l.highlights.priceMode === 'from' ? `${ts('priceMode.from')} ` : ''}
      {price}
      <span className="text-xs text-muted font-normal">{priceSuffix(l, t)}</span>
    </span>
  );
}

export function ListingCard({ l, compact = false }: { l: ListingSummary; compact?: boolean }) {
  const t = useTranslations('listing');
  const th = useTranslations('housing');
  const tj = useTranslations('job');
  const ti = useTranslations('item');
  const locale = useLocale() as AppLocale;
  const h = l.highlights;

  const tags: string[] = [];
  if (l.type === 'housing') {
    tags.push(
      th(`kind.${h.kind as 'whole' | 'share' | 'sublet'}`),
      th('bedrooms', { count: Number(h.bedrooms) }),
      th('bathrooms', { count: Number(h.bathrooms) }),
    );
    if (h.furnished) tags.push(th('furnished'));
  } else if (l.type === 'job') {
    tags.push(tj(`employmentType.${h.employmentType as 'full_time'}`), String(h.companyName ?? ''));
  } else if (l.type === 'item') {
    tags.push(ti(`condition.${h.condition as 'new'}`));
    if (h.negotiable) tags.push(ti('negotiable'));
  } else if (l.type === 'service') {
    tags.push(String(h.serviceArea ?? ''));
  }

  return (
    <Link
      href={`/${LISTING_ROUTES[l.type]}/${l.id}`}
      className={`block rounded border border-gray-100 hover:border-brand/40 hover:shadow-sm ${l.promoted ? 'bg-amber-50 border-amber-300' : 'bg-white'} ${compact ? 'p-2' : 'p-3'}`}
    >
      <div className="flex items-start gap-2">
        {l.promoted && <span className="text-xs text-amber-800">{t('promoted')}</span>}
        <span
          className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded ${l.intent === 'wanted' ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-brand'}`}
        >
          {t(`intentLabel.${l.type}.${l.intent}`)}
        </span>
        <h3 className={`font-medium leading-snug line-clamp-2 ${compact ? 'text-sm' : ''}`}>
          {l.title}
        </h3>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">
          {[cityName(l.city, locale), l.suburb, ...tags.filter(Boolean)]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <ListingPrice l={l} />
      </div>
      {!compact && (
        <div className="mt-1 text-[11px] text-gray-400">{formatDate(l.publishedAt, locale)}</div>
      )}
    </Link>
  );
}
