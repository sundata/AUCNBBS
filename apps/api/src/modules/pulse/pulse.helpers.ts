import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { publicUrl } from '../weekend/weekend.helpers';

export const FEED_CATEGORIES = ['news', 'deal', 'guide', 'notice'] as const;
export const FEED_FORMATS = ['rss', 'json', 'frankfurter', 'openmeteo', 'fuelcheck'] as const;

export const feedSourceInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(120),
  url: publicUrl,
  format: z.enum(FEED_FORMATS),
  category: z.string().trim().min(1).max(30).default('news'),
  cityId: z.string().uuid().nullable().default(null),
  autoPublish: z.boolean().default(false),
  enabled: z.boolean().default(false),
  intervalMinutes: z.number().int().min(15).max(10080).default(360),
});

export const feedItemInput = z.object({
  title: z.string().trim().min(4).max(200),
  summary: z.string().trim().max(1200).default(''),
  imageUrl: publicUrl.nullable().default(null),
  sourceUrl: publicUrl,
  publishedAt: z.string().datetime({ offset: true }).nullable().default(null),
});

export const feedReviewInput = z.object({
  title: z.string().trim().min(4).max(200),
  summary: z.string().trim().max(1200),
  status: z.enum(['pending', 'published', 'rejected']),
  updatedAt: z.string().datetime(),
});

/** URL normalized so tracking params don't defeat deduplication. */
export function fingerprint(url: string) {
  const u = new URL(url);
  u.hash = '';
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return createHash('sha256').update(u.href).digest('hex');
}

const text = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').trim() : '');

/** Generic RSS/Atom → feed items (unlike weekend.events these keep their publication date). */
export function parseNewsFeed(body: string, limit = 50): z.infer<typeof feedItemInput>[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error('XML declarations are not supported');
  if (XMLValidator.validate(body) !== true) throw new Error('Invalid XML feed');
  const doc = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
  }).parse(body);
  if (!doc.rss?.channel && !doc.feed) throw new Error('Expected RSS or Atom');
  const entries = doc.rss?.channel?.item ?? doc.feed?.entry ?? [];
  return (Array.isArray(entries) ? entries : [entries]).slice(0, limit).flatMap((item) => {
    const links = Array.isArray(item.link) ? item.link : [item.link];
    const link = links.find(
      (v: string | Record<string, string> | undefined) =>
        typeof v === 'string' || !v?.['@_rel'] || v['@_rel'] === 'alternate',
    );
    const enclosure = item.enclosure?.['@_url'];
    const media =
      item['media:content']?.['@_url'] ?? item['media:thumbnail']?.['@_url'] ?? enclosure;
    const dateRaw =
      item.pubDate ?? item.published ?? item.updated ?? item['dc:date'] ?? item['dc:created'];
    const parsed = feedItemInput.safeParse({
      title: text(item.title).slice(0, 200),
      summary: text(item.description ?? item.summary ?? item.content).slice(0, 1200),
      sourceUrl: typeof link === 'string' ? link : link?.['@_href'],
      imageUrl: typeof media === 'string' && media.startsWith('https://') ? media : null,
      publishedAt:
        dateRaw && !Number.isNaN(Date.parse(text(dateRaw)))
          ? new Date(text(dateRaw)).toISOString()
          : null,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

/** Partner JSON feeds: `{ items: [...] }` or a bare array of item-shaped rows. */
export function parseJsonFeed(body: string, limit = 50): z.infer<typeof feedItemInput>[] {
  const doc: unknown = JSON.parse(body);
  const rows = Array.isArray(doc)
    ? doc
    : ((doc as { items?: unknown[] }).items ?? (doc as { events?: unknown[] }).events ?? []);
  return (Array.isArray(rows) ? rows : []).slice(0, limit).flatMap((row) => {
    const parsed = feedItemInput.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}
