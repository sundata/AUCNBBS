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

export const POST_TYPES = ['discussion', 'question', 'poll'] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_MOD_ACTIONS = [
  'pin',
  'unpin',
  'lock',
  'unlock',
  'slowmode',
  'move',
  'merge',
] as const;
export type PostModAction = (typeof POST_MOD_ACTIONS)[number];

export const NOTIFICATION_CATEGORIES = [
  'interactions',
  'leads',
  'system',
  'security',
  'marketing',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ['inapp', 'push', 'email', 'sms'] as const;

/** Notification kinds that must always reach the user regardless of preferences. */
export const SECURITY_NOTIFICATION_KINDS = [
  'security.login',
  'security.session_revoked',
  'security.deletion',
  'moderation.action',
  'appeal.decision',
] as const;

export const CONSENT_KINDS = ['terms', 'privacy', 'marketing'] as const;

export const BUSINESS_MEMBER_ROLES = ['owner', 'manager', 'staff'] as const;
export type BusinessMemberRole = (typeof BUSINESS_MEMBER_ROLES)[number];

export const LEAD_STATUSES = ['new', 'replied', 'closed'] as const;

export const SUBSCRIPTION_KINDS = ['business_pro', 'member_plus', 'job_pack'] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];

export const PAYMENT_KINDS = ['promotion', 'subscription', 'job_pack', 'ad'] as const;

export const AD_PLACEMENTS = ['home', 'search', 'channel'] as const;
export const AD_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;

export const EVENT_RECURRENCES = ['weekly', 'fortnightly', 'monthly'] as const;

/** Listing types restricted to users confirmed to be adults (§5.1 年龄门槛). */
export const ADULT_ONLY_LISTING_TYPES = ['housing', 'job'] as const;

export const REPORT_SUBJECT_TYPES = [
  'post',
  'comment',
  'listing',
  'user',
  'article',
  'business',
  'event',
] as const;
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

export const FAVORITE_SUBJECT_TYPES = ['listing', 'post', 'article', 'business', 'event'] as const;
export type FavoriteSubjectType = (typeof FAVORITE_SUBJECT_TYPES)[number];

export const FOLLOW_SUBJECT_TYPES = ['user', 'board', 'business'] as const;
export type FollowSubjectType = (typeof FOLLOW_SUBJECT_TYPES)[number];

export const SAVED_SEARCH_CADENCES = ['instant', 'daily', 'weekly', 'off'] as const;
export type SavedSearchCadence = (typeof SAVED_SEARCH_CADENCES)[number];

export const APPEAL_SUBJECT_TYPES = [
  'listing',
  'post',
  'comment',
  'article',
  'business',
  'event',
] as const;
export type AppealSubjectType = (typeof APPEAL_SUBJECT_TYPES)[number];

export const APPEAL_DECISIONS = ['upheld', 'overturned'] as const;

export const BUSINESS_CATEGORIES = [
  'restaurant',
  'moving',
  'cleaning',
  'repair',
  'accounting',
  'legal',
  'real_estate',
  'education',
  'beauty',
  'automotive',
  'travel',
  'healthcare',
  'other',
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

export const EVENT_CATEGORIES = [
  'community',
  'food',
  'sports',
  'arts',
  'education',
  'career',
  'family',
  'online',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** Roles whose listings bypass the pending_review queue (§5.5 信誉直通). */
export const TRUSTED_LISTING_ROLES = [
  'verified_member',
  'merchant_staff',
  'moderator',
  'editor',
  'support',
  'compliance',
  'admin',
  'super_admin',
] as const;
