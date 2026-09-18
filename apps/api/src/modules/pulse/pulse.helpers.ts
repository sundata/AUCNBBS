import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { publicUrl } from '../weekend/weekend.helpers';

export const FEED_CATEGORIES = [
  'news',
  'deal',
  'event',
  'guide',
  'notice',
  'housing',
  'job',
  'market',
  'service',
] as const;
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

/** Normalized-title hash: the same syndicated article appears in several city feeds. */
export function titleHash(title: string) {
  const norm = title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .trim();
  return norm ? createHash('sha256').update(norm).digest('hex') : null;
}

/**
 * Best-effort en→zh machine translation for collected items.
 * DeepL when DEEPL_API_KEY is set, else the public MyMemory endpoint.
 * Returns null on any failure — the original English text is kept.
 */
export async function translateToZh(text: string): Promise<string | null> {
  if (!text.trim() || /[一-鿿]/.test(text)) return null;
  const input = text.slice(0, 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    if (process.env.DEEPL_API_KEY) {
      const res = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          auth_key: process.env.DEEPL_API_KEY,
          text: input,
          source_lang: 'EN',
          target_lang: 'ZH',
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { translations?: { text?: string }[] };
      return data.translations?.[0]?.text ?? null;
    }
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', input);
    url.searchParams.set('langpair', 'en|zh-CN');
    if (process.env.MYMEMORY_EMAIL) url.searchParams.set('de', process.env.MYMEMORY_EMAIL);
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
    };
    const out = data.responseData?.translatedText;
    return data.responseStatus === 200 && out && !/QUERY LENGTH LIMIT|MYMEMORY WARNING/i.test(out)
      ? out
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** URL normalized so tracking params don't defeat deduplication. */
export function fingerprint(url: string) {
  const u = new URL(url);
  u.hash = '';
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return createHash('sha256').update(u.href).digest('hex');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeEntities = (s: string) =>
  s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X'))
      return String.fromCodePoint(parseInt(e.slice(2), 16) || 0);
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10) || 0);
    return NAMED_ENTITIES[e] ?? m;
  });

const text = (s: unknown) =>
  typeof s === 'string' ? decodeEntities(s.replace(/<[^>]*>/g, '')).trim() : '';

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
