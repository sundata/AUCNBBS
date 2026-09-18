import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';

export const publicUrl = z
  .string()
  .url()
  .max(2048)
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443');
  }, 'Use an HTTPS URL without credentials');
export const eventInput = z.object({
  title: z.string().trim().min(4).max(160),
  summary: z.string().trim().max(800).default(''),
  sourceName: z.string().trim().min(1).max(120),
  sourceUrl: publicUrl,
  cityId: z.string().uuid().nullable().default(null),
  category: z.enum(['general', 'family', 'social', 'market', 'festival']).default('general'),
  suburb: z.string().trim().max(100).default(''),
  venue: z.string().trim().max(200).default(''),
  startsAt: z.string().datetime({ offset: true }).nullable().default(null),
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  priceMinor: z.number().int().min(0).max(10000000).nullable().default(null),
  family: z.boolean().nullable().default(null),
  indoor: z.boolean().nullable().default(null),
  booking: z.enum(['unknown', 'required', 'not_required', 'sold_out']).default('unknown'),
});
export const reviewInput = eventInput
  .extend({
    status: z.enum(['pending', 'published', 'rejected', 'cancelled']),
    updatedAt: z.string().datetime(),
  })
  .superRefine((v, ctx) => {
    if (
      v.status === 'published' &&
      (!v.startsAt || !v.endsAt || v.summary.length < 10 || !v.venue || !v.suburb)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Publishing requires dates, venue, suburb and an original introduction (10+ characters)',
      });
    if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt))
      ctx.addIssue({ code: 'custom', message: 'End must be after start' });
  });
export const WEEKEND_CATEGORIES = ['general', 'family', 'social', 'market', 'festival'] as const;

export const sourceInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(120),
  url: publicUrl,
  format: z.enum(['rss', 'json']),
  cityId: z.string().uuid().nullable().default(null),
  category: z.enum(WEEKEND_CATEGORIES).default('general'),
  enabled: z.boolean().default(false),
  intervalMinutes: z.number().int().min(60).max(10080).default(360),
});
export function fingerprint(url: string, start: string | null) {
  const u = new URL(url);
  u.hash = '';
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return createHash('sha256')
    .update(`${u.href}|${start ? new Date(start).toISOString() : ''}`)
    .digest('hex');
}
const text = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').trim() : '');
export function parseFeed(body: string, format: string, sourceName: string) {
  if (format === 'json') {
    // A partner feed must explicitly identify Sydney, not infer location from keywords.
    return z
      .object({ city: z.literal('Sydney'), events: z.array(eventInput).max(100) })
      .parse(JSON.parse(body)).events;
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error('XML declarations are not supported');
  if (XMLValidator.validate(body) !== true) throw new Error('Invalid XML feed');
  const doc = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
  }).parse(body);
  if (!doc.rss?.channel && !doc.feed) throw new Error('Expected RSS or Atom');
  const entries = doc.rss?.channel?.item ?? doc.feed?.entry ?? [];
  return (Array.isArray(entries) ? entries : [entries]).slice(0, 100).flatMap((item) => {
    const links = Array.isArray(item.link) ? item.link : [item.link];
    const link = links.find(
      (v: string | Record<string, string> | undefined) =>
        typeof v === 'string' || !v?.['@_rel'] || v['@_rel'] === 'alternate',
    );
    const parsed = eventInput.safeParse({
      title: text(item.title).slice(0, 160),
      sourceName,
      sourceUrl: typeof link === 'string' ? link : link?.['@_href'],
    });
    // Feed publication dates are NOT event dates; imported leads remain undated/pending.
    return parsed.success ? [parsed.data] : [];
  });
}

/** Convert a local calendar date at midnight to UTC, including DST transitions. */
export function localMidnight(date: string, timeZone = 'Australia/Sydney'): Date {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    guess += target - local;
  }
  return new Date(guess);
}
export function weekendRange(now = new Date(), timeZone = 'Australia/Sydney') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  const d = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -1 : 6 - day));
  const from = localMidnight(d.toISOString().slice(0, 10), timeZone);
  d.setUTCDate(d.getUTCDate() + 2);
  return { from, to: localMidnight(d.toISOString().slice(0, 10), timeZone) };
}
export function calendar(event: {
  id: string;
  title: string;
  summary: string;
  venue: string;
  sourceUrl: string;
  startsAt: Date;
  endsAt: Date;
}) {
  const escape = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r/g, '');
  const date = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AUCN//Sydney Weekends//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@aucnhub`,
    `DTSTAMP:${date(new Date())}`,
    `DTSTART:${date(event.startsAt)}`,
    `DTEND:${date(event.endsAt)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.summary + '\n' + event.sourceUrl)}`,
    `LOCATION:${escape(event.venue)}`,
    `URL:${event.sourceUrl}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT24H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Event reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return (
    lines
      .map((line) => {
        let result = '',
          bytes = 0;
        for (const c of line) {
          const n = Buffer.byteLength(c);
          if (bytes + n > 73) {
            result += '\r\n ';
            bytes = 1;
          }
          result += c;
          bytes += n;
        }
        return result;
      })
      .join('\r\n') + '\r\n'
  );
}
