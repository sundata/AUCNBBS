export function formatMoney(minor: number | null | undefined, currency = 'AUD'): string | null {
  if (minor === null || minor === undefined) return null;
  const symbol = currency === 'AUD' ? 'A$' : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function cityName(city: { nameZh: string; nameEn: string } | null | undefined): string {
  return city?.nameZh ?? '';
}

export const LISTING_ROUTES = {
  housing: 'housing',
  job: 'jobs',
  item: 'market',
  service: 'services',
} as const;
