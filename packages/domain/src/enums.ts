export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;
export type AuState = (typeof AU_STATES)[number];

export const LISTING_TYPES = ['housing', 'job', 'item', 'service'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_INTENTS = ['offer', 'wanted'] as const;
export type ListingIntent = (typeof LISTING_INTENTS)[number];

export const LISTING_STATUSES = [
  'draft',
  'pending_review',
  'active',
  'reserved',
  'paused',
  'completed',
  'expired',
  'archived',
  'rejected',
  'removed',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const HOUSING_KINDS = ['whole', 'share', 'sublet'] as const;
export const RENT_PERIODS = ['week', 'fortnight', 'month'] as const;
export const PROPERTY_TYPES = [
  'apartment',
  'house',
  'townhouse',
  'studio',
  'room',
  'other',
] as const;

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'casual',
  'contract',
  'internship',
] as const;
export const SALARY_PERIODS = ['hour', 'day', 'week', 'year'] as const;
export const JOB_INDUSTRIES = [
  'it',
  'hospitality',
  'retail',
  'construction',
  'logistics',
  'trade',
  'education',
  'healthcare',
  'finance',
  'real_estate',
  'travel',
  'beauty',
  'legal',
  'other',
] as const;

export const ITEM_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;
export const ITEM_CATEGORIES = [
  'furniture',
  'electronics',
  'vehicle',
  'appliance',
  'clothing',
  'books',
  'kids',
  'sports',
  'other',
] as const;
export const DELIVERY_METHODS = ['pickup', 'delivery', 'post'] as const;

export const SERVICE_CATEGORIES = [
  'moving',
  'automotive',
  'repair',
  'cleaning',
  'renovation',
  'digital',
  'logistics',
  'shipping',
  'events',
  'photography',
  'tutoring',
  'food',
  'other',
] as const;
export const PRICE_MODES = ['quote', 'from', 'hourly', 'negotiable'] as const;

export const POST_TYPES = ['discussion', 'question'] as const;
export type PostType = (typeof POST_TYPES)[number];

export const REPORT_SUBJECT_TYPES = ['post', 'comment', 'listing', 'user', 'article'] as const;
export type ReportSubjectType = (typeof REPORT_SUBJECT_TYPES)[number];
export const REPORT_REASONS = [
  'scam',
  'harassment',
  'hate',
  'discrimination',
  'sexual',
  'violence',
  'self_harm',
  'minor_risk',
  'illegal_goods',
  'privacy',
  'copyright',
  'spam',
  'misinformation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_SEVERITY: Record<ReportReason, number> = {
  scam: 4,
  harassment: 3,
  hate: 4,
  discrimination: 3,
  sexual: 4,
  violence: 4,
  self_harm: 5,
  minor_risk: 5,
  illegal_goods: 4,
  privacy: 3,
  copyright: 2,
  spam: 1,
  misinformation: 2,
  other: 1,
};

export const DEFAULT_LISTING_TTL_DAYS: Record<ListingType, number> = {
  housing: 30,
  job: 30,
  item: 45,
  service: 60,
};
