import type { ListingType } from '@aucn/domain';

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export type SearchScope = 'all' | 'listings' | 'posts' | 'articles' | 'businesses' | 'events';

export interface SearchQuery {
  q: string;
  scope: SearchScope;
  cityId?: string;
  type?: ListingType;
  limit: number;
}

export interface SearchHit {
  kind: 'listing' | 'post' | 'article' | 'business' | 'event';
  id: string;
  title: string;
  snippet: string;
  score: number;
  slug?: string;
  listingType?: ListingType;
  cityId?: string | null;
  createdAt: string;
}

export interface SearchResult {
  q: string;
  hits: SearchHit[];
  total: number;
}

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResult>;
}
