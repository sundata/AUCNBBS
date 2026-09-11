import { z } from 'zod';
import {
  DELIVERY_METHODS,
  EMPLOYMENT_TYPES,
  HOUSING_KINDS,
  ITEM_CATEGORIES,
  ITEM_CONDITIONS,
  JOB_INDUSTRIES,
  LISTING_INTENTS,
  LISTING_TYPES,
  POST_TYPES,
  PRICE_MODES,
  PROPERTY_TYPES,
  RENT_PERIODS,
  REPORT_REASONS,
  REPORT_SUBJECT_TYPES,
  SALARY_PERIODS,
  SERVICE_CATEGORIES,
} from './enums.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .optional();

const minorAmount = z.number().int().nonnegative();

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

const listingBase = z.object({
  intent: z.enum(LISTING_INTENTS),
  title: z.string().min(4).max(120),
  body: z.string().min(10).max(8000),
  cityId: z.string().uuid(),
  priceMinor: minorAmount.optional(),
  contactPolicy: z.enum(['in_app', 'phone_on_request', 'public']).default('in_app'),
});

export const createListingSchema = z.discriminatedUnion('type', [
  listingBase.extend({ type: z.literal(LISTING_TYPES[0]), housing: housingDetailsSchema }),
  listingBase.extend({ type: z.literal(LISTING_TYPES[1]), job: jobDetailsSchema }),
  listingBase.extend({ type: z.literal(LISTING_TYPES[2]), item: itemDetailsSchema }),
  listingBase.extend({ type: z.literal(LISTING_TYPES[3]), service: serviceDetailsSchema }),
]);
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const createPostSchema = z.object({
  boardSlug: z.string().min(1).max(60),
  type: z.enum(POST_TYPES),
  title: z.string().min(4).max(120),
  body: z.string().min(10).max(20000),
  cityId: z.string().uuid().optional(),
  anonymous: z.boolean().default(false),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const createCommentSchema = z.object({
  body: z.string().min(1).max(4000),
  parentId: z.string().uuid().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

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
});
