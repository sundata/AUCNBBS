import type { MetadataRoute } from 'next';
import { api } from '@/lib/api';
import { siteUrl } from '@/lib/site';
import { LISTING_ROUTES } from '@/lib/format';
import type { ListingType } from '@aucn/domain';

const STATIC_PATHS = [
  '',
  '/housing',
  '/jobs',
  '/market',
  '/services',
  '/community',
  '/news',
  '/businesses',
  '/events',
  '/search',
  '/privacy',
  '/terms',
];

interface SitemapEntry {
  id?: string;
  slug?: string;
  type?: string;
  updatedAt?: string;
  publishedAt?: string;
}

/** Fresh public content for the sitemap; capped so generation stays cheap. */
async function contentEntries(): Promise<MetadataRoute.Sitemap> {
  const out: MetadataRoute.Sitemap = [];
  const push = (path: string, modified?: string) => {
    out.push({
      url: `${siteUrl()}/zh${path}`,
      lastModified: modified,
      changeFrequency: 'daily',
      priority: 0.6,
    });
  };
  try {
    const [listings, articles, businesses, events] = await Promise.all([
      api<{ items: SitemapEntry[] }>('/listings?limit=200'),
      api<{ items: SitemapEntry[] }>('/articles?limit=200').catch(() => ({ items: [] })),
      api<{ items: SitemapEntry[] }>('/businesses?limit=200'),
      api<{ items: SitemapEntry[] }>('/events?limit=200'),
    ]);
    for (const l of listings.items)
      push(`/listings/${LISTING_ROUTES[(l.type ?? 'item') as ListingType]}/${l.id}`, l.publishedAt);
    for (const a of articles.items) push(`/news/${a.slug}`, a.publishedAt);
    for (const b of businesses.items) push(`/businesses/${b.id}`, b.updatedAt);
    for (const e of events.items) push(`/events/${e.id}`, e.updatedAt);
  } catch {
    // API offline: serve the static routes only.
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];
  for (const path of STATIC_PATHS) {
    entries.push({
      url: `${siteUrl()}/zh${path}`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: path === '' ? 1 : 0.8,
    });
  }
  return [...entries, ...(await contentEntries())];
}
