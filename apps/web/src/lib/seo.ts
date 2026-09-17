import type { Metadata } from 'next';
import { api, ApiError, type ListingDetail } from '@/lib/api';
import { LISTING_ROUTES } from '@/lib/format';
import { localeAlternates } from '@/lib/site';

async function loadListing(id: string): Promise<ListingDetail | null> {
  try {
    return await api<ListingDetail>(`/listings/${id}`);
  } catch (e) {
    if (e instanceof ApiError && [400, 404].includes(e.problem.status)) return null;
    throw e;
  }
}

/** W-10: per-listing title/description + hreflang; removed content gets noindex. */
export async function listingMetadata(id: string): Promise<Metadata> {
  const l = await loadListing(id);
  if (!l) return {};
  const path = `/listings/${LISTING_ROUTES[l.type]}/${l.id}`;
  return {
    title: l.title,
    description: l.body?.slice(0, 160),
    alternates: localeAlternates(path),
    robots:
      l.status === 'active' || l.status === 'reserved'
        ? undefined
        : { index: false, follow: false },
  };
}

export function listingJsonLd(l: ListingDetail): Record<string, unknown> {
  const base = {
    '@context': 'https://schema.org',
    name: l.title,
    description: l.body?.slice(0, 500),
    datePosted: l.publishedAt,
    areaServed: l.city?.nameEn,
  };
  if (l.type === 'job') return { ...base, '@type': 'JobPosting', title: l.title };
  if (l.type === 'housing') return { ...base, '@type': 'RealEstateListing' };
  if (l.type === 'service') return { ...base, '@type': 'Service' };
  return {
    ...base,
    '@type': 'Product',
    offers:
      l.priceMinor !== null
        ? { '@type': 'Offer', price: l.priceMinor / 100, priceCurrency: l.currency }
        : undefined,
  };
}
