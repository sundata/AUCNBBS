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
  promoted: boolean;
  city: { id: string; slug: string; nameZh: string; nameEn: string };
  suburb: string | null;
  highlights: Record<string, string | number | boolean | null>;
  publishedAt: string | null;
  expiresAt: string;
  createdAt: string;
}
export interface ListingDetail extends ListingSummary {
  version: number;
  body: string;
  contactPolicy: string;
  hasPhone: boolean;
  lat: number | null;
  lng: number | null;
  owner: { id: string; displayName: string; memberSince: string };
  details: Record<string, unknown>;
  viewCount: number;
  reviewNote: string | null;
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
export interface AuthorDto {
  id: string | null;
  displayName: string | null;
  anonymous: boolean;
}
export interface PostSummary {
  id: string;
  boardSlug: string;
  type: string;
  title: string;
  anonymous: boolean;
  author: AuthorDto;
  city: { id: string; slug: string; nameZh: string; nameEn: string } | null;
  commentCount: number;
  viewCount: number;
  pinned: boolean;
  locked: boolean;
  edited: boolean;
  hasPoll: boolean;
  lastActiveAt: string;
  createdAt: string;
}
export interface CommentDto {
  id: string;
  parentId: string | null;
  body: string;
  author: AuthorDto;
  edited: boolean;
  accepted: boolean;
  createdAt: string;
}
export interface PollDto {
  multi: boolean;
  closesAt: string | null;
  closed: boolean;
  totalVotes: number;
  myOptionIds: string[];
  options: { id: string; label: string; votes: number }[];
}
export interface PostDetail extends PostSummary {
  body: string;
  slowmodeSec: number;
  acceptedCommentId: string | null;
  viewerIsAuthor: boolean;
  poll: PollDto | null;
  comments: CommentDto[];
}
export interface PulseMetric {
  kind: string;
  cityId: string | null;
  payload: unknown;
  observedAt: string;
}
export interface PulseFeedItem {
  id: string;
  category: string;
  title: string;
  titleZh: string | null;
  summary: string;
  summaryZh: string | null;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  priceCents: number | null;
  pricePeriod: 'week' | 'hour' | 'day' | 'once' | null;
  location: string | null;
  publishedAt: string;
}
export interface PulseInsights {
  category: string;
  period: 'week' | 'hour' | 'day' | 'once';
  windowDays: number;
  count: number;
  prevCount: number;
  medianPriceCents: number | null;
  prevMedianPriceCents: number | null;
  deltaPct: number | null;
  topLocations: { name: string; count: number }[];
}
export interface PulseDashboard {
  city: CityDto | null;
  metrics: PulseMetric[];
  alerts: PulseFeedItem[];
  events: { id: string; title: string; startsAt: string | null }[];
  hotPosts: { id: string; title: string; commentCount: number; viewCount: number }[];
  newListings: number;
  news: PulseFeedItem[];
  generatedAt: string;
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
  kind: 'listing' | 'post' | 'article' | 'business' | 'event';
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
export interface SessionDto {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}
export interface FavoriteDto {
  id: string;
  subjectType: string;
  subjectId: string;
  title: string | null;
  subjectMeta: string | null;
  createdAt: string;
}
export interface SavedSearchDto {
  id: string;
  name: string;
  query: string;
  cadence: string;
  createdAt: string;
}
export interface BusinessSummary {
  id: string;
  slug: string;
  nameZh: string;
  nameEn: string | null;
  category: string;
  suburb: string;
  city: { id: string; slug: string; nameZh: string; nameEn: string } | null;
  claimed: boolean;
  reviewCount: number;
}
export interface BusinessLocationDto {
  id: string;
  label: string;
  suburb: string;
  address: string | null;
  phone: string | null;
  isPrimary: boolean;
}
export interface OfferDto {
  id: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
}
export interface BusinessLeadDto {
  id: string;
  name: string;
  contact: string;
  message: string;
  source: string;
  status: string;
  createdAt: string;
}
export interface BusinessDetail extends Omit<BusinessSummary, 'reviewCount'> {
  locations: BusinessLocationDto[];
  offers: OfferDto[];
  descriptionZh: string;
  descriptionEn: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  abn: string | null;
  openingHours: string | null;
  priceRange: string | null;
  status: string;
  owner: { id: string; displayName: string } | null;
  ratingAvg: number | null;
  reviewCount: number;
  viewerIsOwner: boolean;
}
export interface BusinessReviewDto {
  id: string;
  rating: number;
  body: string;
  reply: string | null;
  createdAt: string;
  author: { id: string; displayName: string };
}
export interface EventSummary {
  id: string;
  title: string;
  category: string;
  online: boolean;
  venue: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  priceMinor: number | null;
  goingCount: number;
  city: { id: string; slug: string; nameZh: string; nameEn: string };
  organizer: { id: string; displayName: string };
}
export interface EventDetail extends EventSummary {
  body: string;
  externalUrl: string | null;
  status: string;
  viewerRsvp: string | null;
  viewerIsOrganizer: boolean;
  checkinCode: string | null;
  checkedInAt: string | null;
  recurrence: string | null;
  reminderSentAt: string | null;
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
  // CSRF double-submit: cookie-authenticated mutations must echo the
  // readable aucn_csrf cookie in x-csrf-token.
  if (typeof document !== 'undefined' && (rest.method ?? 'GET') !== 'GET') {
    const csrf = document.cookie
      .split('; ')
      .find((c) => c.startsWith('aucn_csrf='))
      ?.split('=')[1];
    if (csrf) headers.set('x-csrf-token', decodeURIComponent(csrf));
  }
  // credentials:'include' lets the browser carry httpOnly session cookies (W-1).
  const res = await fetch(`${apiBase()}/api/v1${path}`, {
    ...rest,
    headers,
    cache: 'no-store',
    credentials: 'include',
  });
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
