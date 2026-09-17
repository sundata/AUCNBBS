import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SearchHit, SearchProvider, SearchQuery, SearchResult } from './search.provider';

interface RawHit {
  kind: 'listing' | 'post' | 'article' | 'business' | 'event';
  id: string;
  title: string;
  snippet: string;
  score: number;
  slug: string | null;
  listing_type: string | null;
  city_id: string | null;
  created_at: Date;
}

/** §5.8 拼音/中英别名：expand a query into the terms its aliases match. */
const QUERY_ALIASES: Record<string, string[]> = {
  sydney: ['悉尼', '雪梨'],
  悉尼: ['sydney'],
  雪梨: ['sydney'],
  melbourne: ['墨尔本'],
  墨尔本: ['melbourne'],
  brisbane: ['布里斯班'],
  布里斯班: ['brisbane'],
  perth: ['珀斯'],
  珀斯: ['perth'],
  adelaide: ['阿德莱德'],
  阿德莱德: ['adelaide'],
  canberra: ['堪培拉'],
  堪培拉: ['canberra'],
  rent: ['租房', '出租'],
  租房: ['rent', 'rental'],
  job: ['招聘', '工作'],
  招聘: ['job', 'hiring'],
};

function expandQuery(q: string): string[] {
  const terms = new Set<string>([q]);
  for (const [key, aliases] of Object.entries(QUERY_ALIASES)) {
    if (q.toLowerCase().includes(key)) for (const a of aliases) terms.add(a);
  }
  return [...terms];
}

/**
 * Increment 0 search: PostgreSQL tsvector (simple config) + trigram similarity fallback for CJK/short terms.
 * City names and suburbs join the match set (W-3); pinyin/alias expansion covers common city queries.
 * Swappable for OpenSearch behind SearchProvider (ADR-003).
 */
@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const q = query.q.trim();
    if (!q) return { q, hits: [], total: 0 };
    const terms = expandQuery(q);
    const patterns = terms.map((t) => `%${t}%`);
    const parts: Prisma.Sql[] = [];

    if (query.scope === 'all' || query.scope === 'listings') {
      parts.push(Prisma.sql`
        SELECT 'listing' AS kind, l.id, l.title, left(l.body, 160) AS snippet,
               ts_rank(l.search_vector, websearch_to_tsquery('simple', ${q})) + similarity(l.title, ${q}) AS score,
               NULL::text AS slug, l.type::text AS listing_type, l.city_id, l.created_at
        FROM listings l
        LEFT JOIN cities c ON c.id = l.city_id
        LEFT JOIN housing_details hd ON hd.listing_id = l.id
        LEFT JOIN job_details jd ON jd.listing_id = l.id
        LEFT JOIN item_details itd ON itd.listing_id = l.id
        LEFT JOIN service_details sd ON sd.listing_id = l.id
        WHERE l.status IN ('active','reserved') AND l.expires_at > now()
          ${query.cityId ? Prisma.sql`AND l.city_id = ${query.cityId}::uuid` : Prisma.empty}
          ${query.type ? Prisma.sql`AND l.type = ${query.type}::"ListingType"` : Prisma.empty}
          AND (l.search_vector @@ websearch_to_tsquery('simple', ${q})
               OR l.title ILIKE ANY (${patterns}) OR l.body ILIKE ANY (${patterns})
               OR c.name_zh ILIKE ANY (${patterns}) OR c.name_en ILIKE ANY (${patterns})
               OR hd.suburb ILIKE ANY (${patterns}) OR jd.suburb ILIKE ANY (${patterns})
               OR itd.suburb ILIKE ANY (${patterns}) OR sd.service_area ILIKE ANY (${patterns}))`);
    }
    if (query.scope === 'all' || query.scope === 'posts') {
      parts.push(Prisma.sql`
        SELECT 'post' AS kind, p.id, p.title, left(p.body, 160) AS snippet,
               ts_rank(p.search_vector, websearch_to_tsquery('simple', ${q})) + similarity(p.title, ${q}) AS score,
               NULL::text AS slug, NULL::text AS listing_type, p.city_id, p.created_at
        FROM posts p
        LEFT JOIN cities c ON c.id = p.city_id
        WHERE p.status = 'published'
          ${query.cityId ? Prisma.sql`AND p.city_id = ${query.cityId}::uuid` : Prisma.empty}
          AND (p.search_vector @@ websearch_to_tsquery('simple', ${q})
               OR p.title ILIKE ANY (${patterns}) OR p.body ILIKE ANY (${patterns})
               OR c.name_zh ILIKE ANY (${patterns}) OR c.name_en ILIKE ANY (${patterns}))`);
    }
    if (query.scope === 'all' || query.scope === 'articles') {
      parts.push(Prisma.sql`
        SELECT 'article' AS kind, a.id, a.title, a.summary AS snippet,
               ts_rank(a.search_vector, websearch_to_tsquery('simple', ${q})) + similarity(a.title, ${q}) AS score,
               a.slug, NULL::text AS listing_type, NULL::uuid AS city_id, a.created_at
        FROM articles a
        WHERE a.status = 'published'
          AND (a.search_vector @@ websearch_to_tsquery('simple', ${q})
               OR a.title ILIKE ANY (${patterns}) OR a.summary ILIKE ANY (${patterns}))`);
    }
    if (query.scope === 'all' || query.scope === 'businesses') {
      parts.push(Prisma.sql`
        SELECT 'business' AS kind, b.id, b.name_zh AS title, left(coalesce(b.description_en, b.description_zh), 160) AS snippet,
               similarity(b.name_zh || ' ' || coalesce(b.name_en, ''), ${q}) AS score,
               NULL::text AS slug, NULL::text AS listing_type, b.city_id, b.created_at
        FROM businesses b
        LEFT JOIN cities c ON c.id = b.city_id
        WHERE b.status = 'active'
          ${query.cityId ? Prisma.sql`AND b.city_id = ${query.cityId}::uuid` : Prisma.empty}
          AND (b.name_zh ILIKE ANY (${patterns}) OR b.name_en ILIKE ANY (${patterns})
               OR b.description_zh ILIKE ANY (${patterns}) OR b.suburb ILIKE ANY (${patterns})
               OR c.name_zh ILIKE ANY (${patterns}) OR c.name_en ILIKE ANY (${patterns}))`);
    }
    if (query.scope === 'all' || query.scope === 'events') {
      parts.push(Prisma.sql`
        SELECT 'event' AS kind, e.id, e.title, left(e.body, 160) AS snippet,
               similarity(e.title, ${q}) AS score,
               NULL::text AS slug, NULL::text AS listing_type, e.city_id, e.created_at
        FROM events e
        LEFT JOIN cities c ON c.id = e.city_id
        WHERE e.status = 'published' AND e.ends_at > now()
          ${query.cityId ? Prisma.sql`AND e.city_id = ${query.cityId}::uuid` : Prisma.empty}
          AND (e.title ILIKE ANY (${patterns}) OR e.body ILIKE ANY (${patterns})
               OR e.venue ILIKE ANY (${patterns})
               OR c.name_zh ILIKE ANY (${patterns}) OR c.name_en ILIKE ANY (${patterns}))`);
    }
    if (parts.length === 0) return { q, hits: [], total: 0 };

    const union = Prisma.join(parts, ' UNION ALL ');
    const rows = await this.prisma.$queryRaw<RawHit[]>(
      Prisma.sql`SELECT * FROM (${union}) hits ORDER BY score DESC, created_at DESC LIMIT ${query.limit}`,
    );
    const hits: SearchHit[] = rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      title: r.title,
      snippet: r.snippet,
      score: Number(r.score),
      slug: r.slug ?? undefined,
      listingType: (r.listing_type as SearchHit['listingType']) ?? undefined,
      cityId: r.city_id,
      createdAt: r.created_at.toISOString(),
    }));
    return { q, hits, total: hits.length };
  }
}
