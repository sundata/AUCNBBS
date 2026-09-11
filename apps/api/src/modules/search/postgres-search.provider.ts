import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SearchHit, SearchProvider, SearchQuery, SearchResult } from './search.provider';

interface RawHit {
  kind: 'listing' | 'post' | 'article';
  id: string;
  title: string;
  snippet: string;
  score: number;
  slug: string | null;
  listing_type: string | null;
  city_id: string | null;
  created_at: Date;
}

/**
 * Increment 0 search: PostgreSQL tsvector (simple config) + trigram similarity fallback for CJK/short terms.
 * Swappable for OpenSearch behind SearchProvider (ADR-003).
 */
@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const q = query.q.trim();
    if (!q) return { q, hits: [], total: 0 };
    const pattern = `%${q}%`;
    const parts: Prisma.Sql[] = [];

    if (query.scope === 'all' || query.scope === 'listings') {
      parts.push(Prisma.sql`
        SELECT 'listing' AS kind, l.id, l.title, left(l.body, 160) AS snippet,
               ts_rank(l.search_vector, websearch_to_tsquery('simple', ${q})) + similarity(l.title, ${q}) AS score,
               NULL::text AS slug, l.type::text AS listing_type, l.city_id, l.created_at
        FROM listings l
        WHERE l.status IN ('active','reserved') AND l.expires_at > now()
          ${query.cityId ? Prisma.sql`AND l.city_id = ${query.cityId}::uuid` : Prisma.empty}
          ${query.type ? Prisma.sql`AND l.type = ${query.type}::"ListingType"` : Prisma.empty}
          AND (l.search_vector @@ websearch_to_tsquery('simple', ${q}) OR l.title ILIKE ${pattern} OR l.body ILIKE ${pattern})`);
    }
    if (query.scope === 'all' || query.scope === 'posts') {
      parts.push(Prisma.sql`
        SELECT 'post' AS kind, p.id, p.title, left(p.body, 160) AS snippet,
               ts_rank(p.search_vector, websearch_to_tsquery('simple', ${q})) + similarity(p.title, ${q}) AS score,
               NULL::text AS slug, NULL::text AS listing_type, p.city_id, p.created_at
        FROM posts p
        WHERE p.status = 'published'
          ${query.cityId ? Prisma.sql`AND p.city_id = ${query.cityId}::uuid` : Prisma.empty}
          AND (p.search_vector @@ websearch_to_tsquery('simple', ${q}) OR p.title ILIKE ${pattern} OR p.body ILIKE ${pattern})`);
    }
    if (query.scope === 'all' || query.scope === 'articles') {
      parts.push(Prisma.sql`
        SELECT 'article' AS kind, a.id, a.title, a.summary AS snippet,
               ts_rank(a.search_vector, websearch_to_tsquery('simple', ${q})) + similarity(a.title, ${q}) AS score,
               a.slug, NULL::text AS listing_type, NULL::uuid AS city_id, a.created_at
        FROM articles a
        WHERE a.status = 'published'
          AND (a.search_vector @@ websearch_to_tsquery('simple', ${q}) OR a.title ILIKE ${pattern} OR a.summary ILIKE ${pattern})`);
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
