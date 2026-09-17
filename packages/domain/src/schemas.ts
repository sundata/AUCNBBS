import { z } from 'zod';
import {
  AD_PLACEMENTS,
  APPEAL_SUBJECT_TYPES,
  BUSINESS_CATEGORIES,
  BUSINESS_MEMBER_ROLES,
  CONSENT_KINDS,
  DELIVERY_METHODS,
  EMPLOYMENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_RECURRENCES,
  FAVORITE_SUBJECT_TYPES,
  FOLLOW_SUBJECT_TYPES,
  HOUSING_KINDS,
  ITEM_CATEGORIES,
  ITEM_CONDITIONS,
  JOB_INDUSTRIES,
  LEAD_STATUSES,
  LISTING_INTENTS,
  LISTING_TYPES,
  PAYMENT_KINDS,
  POST_MOD_ACTIONS,
  POST_TYPES,
  PRICE_MODES,
  PROPERTY_TYPES,
  RENT_PERIODS,
  REPORT_REASONS,
  REPORT_SUBJECT_TYPES,
  SALARY_PERIODS,
  SAVED_SEARCH_CADENCES,
  SERVICE_CATEGORIES,
  SUBSCRIPTION_KINDS,
} from './enums.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .optional();

const minorAmount = z.number().int().nonnegative();

const isoDateTime = z.string().datetime({ offset: true });

export const housingDetailsSchema = z.object({
  kind: z.enum(HOUSING_KINDS),
  propertyType: z.enum(PROPERTY_TYPES),
  rentPeriod: z.enum(RENT_PERIODS),
  bondMinor: minorAmount.optional(),
  billsIncluded: z.boolean().default(false),
  bedrooms: z.number().int().min(0).max(20),
  bathrooms: z.number().int().min(0).max(20),
  parking: z.number().int().min(0).max(20).default(0),
  furnished: z.boolean().default(false),
  availableFrom: isoDate,
  minTermWeeks: z.number().int().min(0).max(520).optional(),
  petsAllowed: z.boolean().optional(),
  suburb: z.string().min(1).max(80),
  postcode: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});

export const jobDetailsSchema = z.object({
  companyName: z.string().min(1).max(120),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  industry: z.enum(JOB_INDUSTRIES),
  salaryMinMinor: minorAmount.optional(),
  salaryMaxMinor: minorAmount.optional(),
  salaryPeriod: z.enum(SALARY_PERIODS).optional(),
  superIncluded: z.boolean().optional(),
  remote: z.boolean().default(false),
  workRightsRequired: z.string().max(200).optional(),
  applyDeadline: isoDate,
  suburb: z.string().min(1).max(80),
});

export const itemDetailsSchema = z.object({
  category: z.enum(ITEM_CATEGORIES),
  condition: z.enum(ITEM_CONDITIONS),
  brand: z.string().max(80).optional(),
  negotiable: z.boolean().default(false),
  deliveryMethods: z.array(z.enum(DELIVERY_METHODS)).min(1),
  quantity: z.number().int().min(1).max(999).default(1),
  suburb: z.string().min(1).max(80),
});

export const serviceDetailsSchema = z.object({
  category: z.enum(SERVICE_CATEGORIES),
  priceMode: z.enum(PRICE_MODES),
  serviceArea: z.string().min(1).max(160),
  isBusiness: z.boolean().default(false),
  abn: z
    .string()
    .regex(/^\d{11}$/, 'ABN must be 11 digits')
    .optional(),
});

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone number');

const listingBase = z.object({
  intent: z.enum(LISTING_INTENTS),
  title: z.string().min(4).max(120),
  body: z.string().min(10).max(8000),
  cityId: z.string().uuid(),
  priceMinor: minorAmount.optional(),
  contactPolicy: z.enum(['in_app', 'phone_on_request', 'public']).default('in_app'),
  contactPhone: phone.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const createListingSchema = z.discriminatedUnion('type', [
  listingBase.extend({ type: z.literal(LISTING_TYPES[0]), housing: housingDetailsSchema }),
  listingBase.extend({ type: z.literal(LISTING_TYPES[1]), job: jobDetailsSchema }),
  listingBase.extend({ type: z.literal(LISTING_TYPES[2]), item: itemDetailsSchema }),
  listingBase.extend({ type: z.literal(LISTING_TYPES[3]), service: serviceDetailsSchema }),
]);
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const pollSchema = z.object({
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(10),
  multi: z.boolean().default(false),
  closesAt: isoDateTime.optional(),
});

export const createPostSchema = z
  .object({
    boardSlug: z.string().min(1).max(60),
    type: z.enum(POST_TYPES),
    title: z.string().min(4).max(120),
    body: z.string().min(10).max(20000),
    cityId: z.string().uuid().optional(),
    anonymous: z.boolean().default(false),
    poll: pollSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'poll' && !v.poll)
      ctx.addIssue({ code: 'custom', message: 'Poll posts require poll options' });
    if (v.type !== 'poll' && v.poll)
      ctx.addIssue({ code: 'custom', message: 'poll options only allowed for poll posts' });
  });
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  title: z.string().min(4).max(120).optional(),
  body: z.string().min(10).max(20000).optional(),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const votePollSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(1).max(10),
});

export const acceptAnswerSchema = z.object({
  commentId: z.string().uuid(),
});

export const postModActionSchema = z.object({
  action: z.enum(POST_MOD_ACTIONS),
  boardSlug: z.string().min(1).max(60).optional(), // for move
  targetPostId: z.string().uuid().optional(), // for merge
  slowmodeSec: z.number().int().min(0).max(86400).optional(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1).max(4000),
  parentId: z.string().uuid().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(4000),
});
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export const createReportSchema = z.object({
  subjectType: z.enum(REPORT_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(2000).optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const otpRequestSchema = z.object({ email: z.string().email().max(254) });
export const otpVerifySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(40).optional(),
  locale: z.enum(['zh', 'en']).optional(),
  homeCityId: z.string().uuid().nullable().optional(),
  bio: z.string().max(300).optional(),
  interests: z.array(z.string().min(1).max(60)).max(20).optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  marketingOptOut: z.boolean().optional(),
  personalizationOff: z.boolean().optional(),
  onboarded: z.boolean().optional(),
});

const channelPrefs = z.object({
  inapp: z.boolean().default(true),
  push: z.boolean().default(true),
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
});

export const notificationPrefsSchema = z.object({
  interactions: channelPrefs.optional(),
  leads: channelPrefs.optional(),
  system: channelPrefs.optional(),
  security: channelPrefs.optional(),
  marketing: channelPrefs.optional(),
});
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

export const favoriteSchema = z.object({
  subjectType: z.enum(FAVORITE_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
});
export type FavoriteInput = z.infer<typeof favoriteSchema>;

export const followSchema = z.object({
  subjectType: z.enum(FOLLOW_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
});

export const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(200),
  filters: z.record(z.unknown()).optional(),
  cadence: z.enum(SAVED_SEARCH_CADENCES).default('daily'),
});

export const updateSavedSearchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  cadence: z.enum(SAVED_SEARCH_CADENCES).optional(),
});

export const createAppealSchema = z.object({
  subjectType: z.enum(APPEAL_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  reason: z.string().trim().min(10).max(2000),
});
export type CreateAppealInput = z.infer<typeof createAppealSchema>;

const abn = z
  .string()
  .regex(/^\d{11}$/, 'ABN must be 11 digits')
  .optional();

export const businessSchema = z.object({
  nameZh: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(160).optional(),
  category: z.enum(BUSINESS_CATEGORIES),
  descriptionZh: z.string().trim().max(4000).default(''),
  descriptionEn: z.string().trim().max(4000).optional(),
  suburb: z.string().trim().min(1).max(80),
  address: z.string().trim().max(200).optional(),
  cityId: z.string().uuid().optional(),
  phone: z.string().trim().max(40).optional(),
  website: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v))
    .optional(),
  abn,
  openingHours: z.string().trim().max(300).optional(),
  priceRange: z.string().trim().max(40).optional(),
});
export type BusinessInput = z.infer<typeof businessSchema>;

export const businessClaimSchema = z.object({
  evidence: z.string().trim().min(10).max(2000),
});

export const businessReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  ratingService: z.number().int().min(1).max(5).optional(),
  ratingValue: z.number().int().min(1).max(5).optional(),
  ratingQuality: z.number().int().min(1).max(5).optional(),
  body: z.string().trim().min(10).max(2000),
});

export const businessReplySchema = z.object({
  reply: z.string().trim().min(1).max(2000),
});

export const businessLocationSchema = z.object({
  label: z.string().trim().max(80).default(''),
  suburb: z.string().trim().min(1).max(80),
  address: z.string().trim().max(200).optional(),
  phone: phone.optional(),
  openingHours: z.string().trim().max(300).optional(),
  isPrimary: z.boolean().default(false),
});

export const businessMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(BUSINESS_MEMBER_ROLES).default('staff'),
});

export const businessLeadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  contact: z.string().trim().min(3).max(120),
  message: z.string().trim().min(5).max(2000),
});

export const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES),
});

export const offerSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().max(2000).default(''),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
});

export const eventSchema = z.object({
  title: z.string().trim().min(4).max(140),
  body: z.string().trim().min(10).max(8000),
  category: z.enum(EVENT_CATEGORIES),
  cityId: z.string().uuid(),
  venue: z.string().trim().max(200).optional(),
  online: z.boolean().default(false),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  capacity: z.number().int().min(1).max(100000).optional(),
  priceMinor: z.number().int().nonnegative().optional(),
  externalUrl: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v))
    .optional(),
  recurrence: z.enum(EVENT_RECURRENCES).optional(),
});
export type EventInput = z.infer<typeof eventSchema>;

// ---------- MFA / TOTP (§5.1) ----------

export const totpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const mfaCompleteSchema = z.object({
  ticket: z.string().min(20).max(200),
  code: z.string().regex(/^\d{6}$/),
});

// ---------- Consent & privacy (§13) ----------

export const consentSchema = z.object({
  kind: z.enum(CONSENT_KINDS),
  version: z.string().trim().min(1).max(40),
  granted: z.boolean().default(true),
});

// ---------- Billing / monetisation (§9) ----------

export const checkoutSchema = z.object({
  kind: z.enum(PAYMENT_KINDS),
  listingId: z.string().uuid().optional(), // required for promotion
  businessId: z.string().uuid().optional(), // for subscription / ad
});

export const adCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().max(500).default(''),
  targetUrl: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v)),
  imageUrl: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v))
    .optional(),
  cityId: z.string().uuid().optional(),
  placement: z.enum(AD_PLACEMENTS).default('home'),
  budgetMinor: z.number().int().min(100).max(10_000_000),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
});
export type AdCampaignInput = z.infer<typeof adCampaignSchema>;

export const updateAdCampaignSchema = z.object({
  status: z.enum(['paused', 'active', 'ended']).optional(),
  budgetMinor: z.number().int().min(100).max(10_000_000).optional(),
});

export const subscriptionCheckoutSchema = z.object({
  kind: z.enum(SUBSCRIPTION_KINDS),
  businessId: z.string().uuid().optional(),
});
