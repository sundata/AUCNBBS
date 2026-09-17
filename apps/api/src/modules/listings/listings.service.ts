import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ADULT_ONLY_LISTING_TYPES,
  canTransition,
  effectiveListingStatus,
  CreateListingInput,
  DEFAULT_LISTING_TTL_DAYS,
  ListingIntent,
  ListingStatus,
  ListingType,
  PUBLIC_LISTING_STATUSES,
  TRUSTED_LISTING_ROLES,
} from '@aucn/domain';
import { Prisma } from '@prisma/client';
import { CursorQuery, decodeCursor, Page, toPage } from '../../common/pagination';
import { outbox } from '../../common/outbox';
import { riskScreenListing } from '../../common/risk';
import { PrismaService } from '../prisma/prisma.service';

export interface ListingSummaryDto {
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
  createdAt: Date;
}

export interface ListingDetailDto extends ListingSummaryDto {
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

export const listingInclude = {
  city: { select: { id: true, slug: true, nameZh: true, nameEn: true } },
  owner: { select: { id: true, displayName: true, createdAt: true } },
  housing: true,
  job: true,
  item: true,
  service: true,
} satisfies Prisma.ListingInclude;

export type ListingRow = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;

function details(row: ListingRow): Record<string, unknown> {
  const raw = row.housing ?? row.job ?? row.item ?? row.service;
  if (!raw) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'listingId'));
}

function highlights(row: ListingRow): ListingSummaryDto['highlights'] {
  if (row.housing) {
    return {
      kind: row.housing.kind,
      bedrooms: row.housing.bedrooms,
      bathrooms: row.housing.bathrooms,
      rentPeriod: row.housing.rentPeriod,
      furnished: row.housing.furnished,
    };
  }
  if (row.job) {
    return {
      employmentType: row.job.employmentType,
      industry: row.job.industry,
      salaryMinMinor: row.job.salaryMinMinor,
      salaryMaxMinor: row.job.salaryMaxMinor,
      salaryPeriod: row.job.salaryPeriod,
      companyName: row.job.companyName,
    };
  }
  if (row.item)
    return {
      category: row.item.category,
      condition: row.item.condition,
      negotiable: row.item.negotiable,
    };
  if (row.service)
    return {
      category: row.service.category,
      priceMode: row.service.priceMode,
      isBusiness: row.service.isBusiness,
      serviceArea: row.service.serviceArea,
    };
  return {};
}

export function toListingSummary(row: ListingRow): ListingSummaryDto {
  return {
    id: row.id,
    type: row.type,
    intent: row.intent,
    status: effectiveListingStatus(row.status, row.expiresAt),
    title: row.title,
    priceMinor: row.priceMinor,
    currency: row.currency,
    promoted: !!row.promotedUntil && row.promotedUntil > new Date(),
    city: row.city,
    suburb: row.housing?.suburb ?? row.job?.suburb ?? row.item?.suburb ?? null,
    highlights: highlights(row),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt,
  };
}

export function toListingDetail(row: ListingRow): ListingDetailDto {
  return {
    ...toListingSummary(row),
    version: row.version,
    body: row.body,
    contactPolicy: row.contactPolicy,
    // The phone number itself is only served by POST /listings/:id/phone (audited).
    hasPhone: !!row.contactPhone,
    lat: row.lat,
    lng: row.lng,
    owner: {
      id: row.owner.id,
      displayName: row.owner.displayName,
      memberSince: row.owner.createdAt.toISOString(),
    },
    details: details(row),
    viewCount: row.viewCount,
    reviewNote: row.reviewNote,
  };
}

export function publicListingWhere(now = new Date()): Prisma.ListingWhereInput {
  return { status: { in: [...PUBLIC_LISTING_STATUSES] }, expiresAt: { gt: now } };
}

export interface ListingsQuery extends CursorQuery {
  type?: ListingType;
  intent?: ListingIntent;
  cityId?: string;
  priceMin?: number;
  priceMax?: number;
  suburb?: string;
  bedrooms?: number;
  sort?: 'latest' | 'price_asc' | 'price_desc' | 'near';
  lat?: number;
  lng?: number;
}

/** Distance cursor `near:{meters}|{id}` for keyset pagination over haversine order. */
function decodeNearCursor(cursor?: string): { d: number; id: string } | null {
  if (!cursor?.startsWith('near:')) return null;
  const [d, id] = cursor.slice(5).split('|');
  const dist = Number(d);
  return Number.isFinite(dist) && id ? { d: dist, id } : null;
}

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListingsQuery): Promise<Page<ListingSummaryDto>> {
    if (query.sort === 'near' && query.lat !== undefined && query.lng !== undefined)
      return this.listNear(query);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.listing.findMany({
      where: {
        ...publicListingWhere(),
        ...(query.type ? { type: query.type } : {}),
        ...(query.intent ? { intent: query.intent } : {}),
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.priceMin !== undefined || query.priceMax !== undefined
          ? { priceMinor: { gte: query.priceMin, lte: query.priceMax } }
          : {}),
        ...(query.suburb
          ? {
              OR: [
                { housing: { suburb: { equals: query.suburb, mode: 'insensitive' as const } } },
                { job: { suburb: { equals: query.suburb, mode: 'insensitive' as const } } },
                { item: { suburb: { equals: query.suburb, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
        ...(query.bedrooms !== undefined ? { housing: { bedrooms: { gte: query.bedrooms } } } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy:
        query.sort === 'price_asc'
          ? [
              { priceMinor: 'asc' as const },
              { createdAt: 'desc' as const },
              { id: 'desc' as const },
            ]
          : query.sort === 'price_desc'
            ? [
                { priceMinor: 'desc' as const },
                { createdAt: 'desc' as const },
                { id: 'desc' as const },
              ]
            : [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: query.limit + 1,
      include: listingInclude,
    });
    return toPage(rows.map(toListingSummary), query.limit);
  }

  /**
   * N-16 (minimal): distance-ordered browse without PostGIS — haversine over
   * the lat/lng columns, keyset-paginated on (distance, id).
   */
  private async listNear(query: ListingsQuery): Promise<Page<ListingSummaryDto>> {
    const dist = Prisma.sql`(6371000 * acos(GREATEST(-1, LEAST(1, cos(radians(${query.lat})) * cos(radians(l.lat)) * cos(radians(l.lng) - radians(${query.lng})) + sin(radians(${query.lat})) * sin(radians(l.lat))))))`;
    const conds: Prisma.Sql[] = [
      Prisma.sql`l.status::text IN (${Prisma.join(PUBLIC_LISTING_STATUSES.map((s) => Prisma.sql`${s}`))})`,
      Prisma.sql`l.expires_at > now()`,
      Prisma.sql`l.lat IS NOT NULL`,
      Prisma.sql`l.lng IS NOT NULL`,
    ];
    if (query.type) conds.push(Prisma.sql`l.type::text = ${query.type}`);
    if (query.intent) conds.push(Prisma.sql`l.intent::text = ${query.intent}`);
    if (query.cityId) conds.push(Prisma.sql`l.city_id = ${query.cityId}::uuid`);
    if (query.priceMin !== undefined) conds.push(Prisma.sql`l.price_minor >= ${query.priceMin}`);
    if (query.priceMax !== undefined) conds.push(Prisma.sql`l.price_minor <= ${query.priceMax}`);
    if (query.suburb)
      conds.push(
        Prisma.sql`(lower(h.suburb) = lower(${query.suburb}) OR lower(j.suburb) = lower(${query.suburb}) OR lower(i.suburb) = lower(${query.suburb}))`,
      );
    if (query.bedrooms !== undefined) conds.push(Prisma.sql`h.bedrooms >= ${query.bedrooms}`);
    const c = decodeNearCursor(query.cursor);
    if (c)
      conds.push(Prisma.sql`(${dist} > ${c.d} OR (${dist} = ${c.d} AND l.id < ${c.id}::uuid))`);
    const rows = await this.prisma.$queryRaw<{ id: string; d: number }[]>(Prisma.sql`
      SELECT l.id, ${dist} AS d FROM listings l
      LEFT JOIN housing_details h ON h.listing_id = l.id
      LEFT JOIN job_details j ON j.listing_id = l.id
      LEFT JOIN item_details i ON i.listing_id = l.id
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY ${dist} ASC, l.id DESC
      LIMIT ${query.limit + 1}`);
    const page = rows.slice(0, query.limit);
    const hydrated = await this.prisma.listing.findMany({
      where: { id: { in: page.map((r) => r.id) } },
      include: listingInclude,
    });
    const byId = new Map(hydrated.map((r) => [r.id, r]));
    const items = page
      .map((r) => byId.get(r.id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(toListingSummary);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > query.limit && last ? `near:${last.d}|${last.id}` : null,
    };
  }

  async get(id: string, viewerId?: string): Promise<ListingDetailDto> {
    const row = await this.prisma.listing.findUnique({ where: { id }, include: listingInclude });
    if (!row) throw new NotFoundException('Listing not found');
    const isOwner = viewerId !== undefined && row.ownerId === viewerId;
    const isPublic = PUBLIC_LISTING_STATUSES.includes(row.status) && row.expiresAt > new Date();
    if (!isPublic && !isOwner) throw new NotFoundException('Listing not found');
    if (!isOwner)
      await this.prisma.listing.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return toListingDetail(row);
  }

  async mine(ownerId: string, query: CursorQuery): Promise<Page<ListingSummaryDto>> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.listing.findMany({
      where: {
        ownerId,
        status: { notIn: ['removed'] },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: listingInclude,
    });
    return toPage(rows.map(toListingSummary), query.limit);
  }

  async create(ownerId: string, input: CreateListingInput): Promise<ListingDetailDto> {
    const city = await this.prisma.city.findUnique({ where: { id: input.cityId } });
    if (!city) throw new UnprocessableEntityException('Unknown city');
    if (input.type === 'service' && input.service.isBusiness && !input.service.abn) {
      throw new UnprocessableEntityException('Business services must provide an ABN');
    }
    if (input.contactPolicy !== 'in_app' && !input.contactPhone)
      throw new UnprocessableEntityException('Phone contact requires a phone number');
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { role: true, birthYear: true },
    });
    // §5.1 年龄门槛：housing/job are adult-only categories once age is known.
    if (
      owner?.birthYear &&
      (ADULT_ONLY_LISTING_TYPES as readonly string[]).includes(input.type) &&
      new Date().getFullYear() - owner.birthYear < 18
    )
      throw new ForbiddenException('You must be 18 or older to publish this listing type');
    // §5.5 发布时风控：any flag forces the human review queue even for trusted roles.
    const riskFlags = await riskScreenListing(this.prisma, {
      ownerId,
      type: input.type,
      title: input.title,
      body: input.body,
      priceMinor: input.priceMinor,
      salaryMinMinor: input.type === 'job' ? input.job.salaryMinMinor : undefined,
    });
    // §5.5 信誉直通：trusted roles publish immediately; plain members enter the review queue.
    const trusted =
      !!owner &&
      (TRUSTED_LISTING_ROLES as readonly string[]).includes(owner.role) &&
      riskFlags.length === 0;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_LISTING_TTL_DAYS[input.type] * 86_400_000);
    const base = {
      ownerId,
      type: input.type,
      intent: input.intent,
      status: (trusted ? 'active' : 'pending_review') as ListingStatus,
      title: input.title,
      body: input.body,
      cityId: input.cityId,
      priceMinor: input.priceMinor,
      contactPolicy: input.contactPolicy,
      contactPhone: input.contactPhone ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      riskFlags,
      publishedAt: trusted ? now : null,
      expiresAt,
    };
    const data: Prisma.ListingUncheckedCreateInput =
      input.type === 'housing'
        ? {
            ...base,
            housing: {
              create: {
                ...input.housing,
                availableFrom: input.housing.availableFrom
                  ? new Date(input.housing.availableFrom)
                  : undefined,
              },
            },
          }
        : input.type === 'job'
          ? {
              ...base,
              job: {
                create: {
                  ...input.job,
                  applyDeadline: input.job.applyDeadline
                    ? new Date(input.job.applyDeadline)
                    : undefined,
                },
              },
            }
          : input.type === 'item'
            ? { ...base, item: { create: input.item } }
            : { ...base, service: { create: input.service } };
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.listing.create({ data, include: listingInclude });
      await outbox(tx, `listing:${created.id}`, 'listing.created', {
        listingId: created.id,
        ownerId,
        type: input.type,
        status: created.status,
        riskFlags,
      });
      return created;
    });
    return toListingDetail(row);
  }

  async update(
    ownerId: string,
    id: string,
    version: number,
    input: CreateListingInput,
  ): Promise<ListingDetailDto> {
    const old = await this.prisma.listing.findUnique({ where: { id } });
    if (!old) throw new NotFoundException('Listing not found');
    if (old.ownerId !== ownerId) throw new ForbiddenException('Not the owner');
    // Rejected listings are editable so the owner can fix and resubmit; editing
    // parks them back in draft. Removed/archived/completed and in-flight reviews stay locked.
    if (['removed', 'archived', 'completed', 'pending_review'].includes(old.status))
      throw new ForbiddenException('This listing cannot be edited');
    if (input.type !== old.type)
      throw new UnprocessableEntityException('Listing type cannot change');
    if (!(await this.prisma.city.findUnique({ where: { id: input.cityId } })))
      throw new UnprocessableEntityException('Unknown city');
    if (input.type === 'service' && input.service.isBusiness && !input.service.abn)
      throw new UnprocessableEntityException('Business services must provide an ABN');
    if (input.contactPolicy !== 'in_app' && !input.contactPhone)
      throw new UnprocessableEntityException('Phone contact requires a phone number');
    const riskFlags = await riskScreenListing(this.prisma, {
      ownerId,
      type: input.type,
      title: input.title,
      body: input.body,
      priceMinor: input.priceMinor,
      salaryMinMinor: input.type === 'job' ? input.job.salaryMinMinor : undefined,
    });
    const data: Prisma.ListingUpdateInput = {
      title: input.title,
      body: input.body,
      intent: input.intent,
      city: { connect: { id: input.cityId } },
      priceMinor: input.priceMinor ?? null,
      contactPolicy: input.contactPolicy,
      contactPhone: input.contactPhone ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      riskFlags,
      version: { increment: 1 },
      ...(old.status === 'rejected' ? { status: 'draft' as const } : {}),
    };
    // Full replacement of detail fields; omitted optional fields clear their previous values.
    if (input.type === 'housing')
      data.housing = {
        update: {
          ...input.housing,
          bondMinor: input.housing.bondMinor ?? null,
          postcode: input.housing.postcode ?? null,
          minTermWeeks: input.housing.minTermWeeks ?? null,
          petsAllowed: input.housing.petsAllowed ?? null,
          availableFrom: input.housing.availableFrom ? new Date(input.housing.availableFrom) : null,
        },
      };
    if (input.type === 'job')
      data.job = {
        update: {
          ...input.job,
          salaryMinMinor: input.job.salaryMinMinor ?? null,
          salaryMaxMinor: input.job.salaryMaxMinor ?? null,
          salaryPeriod: input.job.salaryPeriod ?? null,
          superIncluded: input.job.superIncluded ?? null,
          workRightsRequired: input.job.workRightsRequired ?? null,
          applyDeadline: input.job.applyDeadline ? new Date(input.job.applyDeadline) : null,
        },
      };
    if (input.type === 'item')
      data.item = { update: { ...input.item, brand: input.item.brand ?? null } };
    if (input.type === 'service')
      data.service = { update: { ...input.service, abn: input.service.abn ?? null } };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.listing.update({
          where: { id, version, status: old.status },
          data,
          include: listingInclude,
        });
        await tx.auditLog.create({
          data: {
            actorId: ownerId,
            action: 'listing.update',
            subject: `listing:${id}`,
            metadata: { previousVersion: version },
          },
        });
        return toListingDetail(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        throw new ConflictException('Listing changed; refresh and try again');
      throw error;
    }
  }

  async changeStatus(ownerId: string, id: string, to: ListingStatus): Promise<ListingDetailDto> {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Listing not found');
    if (row.ownerId !== ownerId) throw new ForbiddenException('Not the owner');
    // draft lets the owner pull a rejected listing back for rework; pending_review is the resubmit target.
    const ownerAllowed: readonly ListingStatus[] = [
      'active',
      'reserved',
      'paused',
      'completed',
      'archived',
      'draft',
      'pending_review',
    ];
    if (!ownerAllowed.includes(to)) throw new ForbiddenException(`Owners cannot set status ${to}`);
    const now = new Date();
    const from = effectiveListingStatus(row.status, row.expiresAt, now);
    if (!canTransition(from, to)) {
      throw new UnprocessableEntityException(`Cannot transition listing from ${from} to ${to}`);
    }
    // Owners may withdraw a pending review to draft but cannot self-approve; and a
    // member-owned draft must resubmit for review rather than jump straight to active.
    if (from === 'pending_review' && to !== 'draft')
      throw new ForbiddenException('A listing under review can only be withdrawn to draft');
    if (from === 'draft' && to === 'active') {
      const owner = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { role: true },
      });
      const trusted = !!owner && (TRUSTED_LISTING_ROLES as readonly string[]).includes(owner.role);
      if (!trusted || row.riskFlags.length > 0)
        throw new ForbiddenException('Members must resubmit for review');
    }
    const renew = to === 'active' && from === 'expired';
    let updated: ListingRow;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.listing.update({
          where: { id, version: row.version },
          data: {
            status: to,
            version: { increment: 1 },
            ...(renew
              ? {
                  expiresAt: new Date(
                    now.getTime() + DEFAULT_LISTING_TTL_DAYS[row.type] * 86_400_000,
                  ),
                  publishedAt: now,
                }
              : {}),
          },
          include: listingInclude,
        });
        await outbox(tx, `listing:${id}`, 'listing.status_changed', {
          listingId: id,
          ownerId,
          from,
          to,
        });
        return u;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('Listing changed; refresh and try again');
      }
      throw error;
    }
    return toListingDetail(updated);
  }

  /**
   * §5.9 联系方式策略：phone_on_request/public listings expose the number only
   * to signed-in users, and every reveal is audit-logged.
   */
  async revealPhone(viewerId: string, id: string): Promise<{ phone: string }> {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    const visible =
      row && PUBLIC_LISTING_STATUSES.includes(row.status) && row.expiresAt > new Date();
    if (!row || (!visible && row.ownerId !== viewerId))
      throw new NotFoundException('Listing not found');
    if (!row.contactPhone || row.contactPolicy === 'in_app')
      throw new NotFoundException('No phone contact for this listing');
    await this.prisma.auditLog.create({
      data: {
        actorId: viewerId,
        action: 'listing.phone_reveal',
        subject: `listing:${id}`,
      },
    });
    return { phone: row.contactPhone };
  }

  /** Marks stale active/reserved listings as expired. Intended for a scheduler; also safe to call ad hoc. */
  async expireStale(now = new Date()): Promise<number> {
    const res = await this.prisma.listing.updateMany({
      where: { status: { in: ['active', 'reserved', 'paused'] }, expiresAt: { lte: now } },
      data: { status: 'expired', version: { increment: 1 } },
    });
    return res.count;
  }
}
