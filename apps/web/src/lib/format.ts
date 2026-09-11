import type { AppLocale } from '@/i18n/routing';

export function formatMoney(minor: number | null | undefined, currency = 'AUD'): string | null {
  if (minor === null || minor === undefined) return null;
  const symbol = currency === 'AUD' ? 'A$' : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string | null | undefined, locale: AppLocale): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-AU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function cityName(
  city: { nameZh: string; nameEn: string } | null | undefined,
  locale: AppLocale,
): string {
  if (!city) return '';
  return locale === 'zh' ? city.nameZh : city.nameEn;
}

export const LISTING_ROUTES = {
  housing: 'housing',
  job: 'jobs',
  item: 'market',
  service: 'services',
} as const;
