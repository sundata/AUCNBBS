import type { ListingIntent, ListingStatus, ListingType } from '@aucn/domain';

export interface CityDto {
  id: string;
  slug: string;
  state: string;
  nameZh: string;
  nameEn: string;
  isLaunch: boolean;
}
export interface ListingSummary {
  id: string;
  type: ListingType;
  intent: ListingIntent;
  status: ListingStatus;
  title: string;
  priceMinor: number | null;
  currency: string;
  city: { id: string; slug: string; nameZh: string; nameEn: string };
  suburb: string | null;
  highlights: Record<string, string | number | boolean | null>;
  publishedAt: string | null;
  expiresAt: string;
  createdAt: string;
}
export interface ListingDetail extends ListingSummary {
  body: string;
  contactPolicy: string;
  owner: { id: string; displayName: string; memberSince: string };
  details: Record<string, unknown>;
  viewCount: number;
}
export interface ArticleSummary {
  id: string;
  slug: string;
  category: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  publishedAt: string | null;
}
export interface ArticleDetail extends ArticleSummary {
  body: string;
  source: string | null;
  author: { id: string; displayName: string };
}
export interface BoardDto {
  id: string;
  slug: string;
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  postCount: number;
}
export interface PostSummary {
  id: string;
  boardSlug: string;
  type: string;
  title: string;
  anonymous: boolean;
  author: { id: string | null; displayName: string };
  city: { id: string; slug: string; nameZh: string; nameEn: string } | null;
  commentCount: number;
  viewCount: number;
  pinned: boolean;
  lastActiveAt: string;
  createdAt: string;
}
export interface CommentDto {
  id: string;
  parentId: string | null;
  body: string;
  author: { id: string; displayName: string };
  createdAt: string;
}
export interface PostDetail extends PostSummary {
  body: string;
  comments: CommentDto[];
}
export interface HomeFeed {
  city: { id: string; slug: string; nameZh: string; nameEn: string } | null;
  headlines: ArticleSummary[];
  hotPosts: {
    id: string;
    boardSlug: string;
    title: string;
    commentCount: number;
    lastActiveAt: string;
  }[];
  listings: Record<ListingType, ListingSummary[]>;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface SearchHit {
  kind: 'listing' | 'post' | 'article';
  id: string;
  title: string;
  snippet: string;
  slug?: string;
  listingType?: ListingType;
  createdAt: string;
}
export interface SearchResult {
  q: string;
  hits: SearchHit[];
  total: number;
}
export interface ProblemDetails {
  title: string;
  status: number;
  detail?: string;
  errors?: { fieldErrors?: Record<string, string[]> };
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

/** Server components call the API directly (internal URL); the browser uses the public URL. */
export function apiBase(): string {
  if (typeof window === 'undefined') {
    return (
      process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    );
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

export async function api<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('accept', 'application/json');
  if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${apiBase()}/api/v1${path}`, { ...rest, headers, cache: 'no-store' });
  if (!res.ok) {
    let problem: ProblemDetails = { title: res.statusText, status: res.status };
    try {
      problem = (await res.json()) as ProblemDetails;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(problem);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const qs = (params: Record<string, string | number | undefined | null>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};
