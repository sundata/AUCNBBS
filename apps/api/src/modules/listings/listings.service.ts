import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  canTransition,
  CreateListingInput,
  DEFAULT_LISTING_TTL_DAYS,
  ListingIntent,
  ListingStatus,
  ListingType,
  PUBLIC_LISTING_STATUSES,
} from '@aucn/domain';
import type { Prisma } from '@prisma/client';
import { CursorQuery, decodeCursor, Page, toPage } from '../../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

export interface ListingSummaryDto {
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
  createdAt: Date;
}

export interface ListingDetailDto extends ListingSummaryDto {
  body: string;
  contactPolicy: string;
  owner: { id: string; displayName: string; memberSince: string };
  details: Record<string, unknown>;
  viewCount: number;
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
    status: row.status,
    title: row.title,
    priceMinor: row.priceMinor,
    currency: row.currency,
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
    body: row.body,
    contactPolicy: row.contactPolicy,
    owner: {
      id: row.owner.id,
      displayName: row.owner.displayName,
      memberSince: row.owner.createdAt.toISOString(),
    },
    details: details(row),
    viewCount: row.viewCount,
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
}

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListingsQuery): Promise<Page<ListingSummaryDto>> {
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_LISTING_TTL_DAYS[input.type] * 86_400_000);
    const base = {
      ownerId,
      type: input.type,
      intent: input.intent,
      // Increment 0: no moderation queue yet; listings go live immediately (see ADR-005).
      status: 'active' as const,
      title: input.title,
      body: input.body,
      cityId: input.cityId,
      priceMinor: input.priceMinor,
      contactPolicy: input.contactPolicy,
      publishedAt: now,
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
    const row = await this.prisma.listing.create({ data, include: listingInclude });
    return toListingDetail(row);
  }

  async changeStatus(ownerId: string, id: string, to: ListingStatus): Promise<ListingDetailDto> {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Listing not found');
    if (row.ownerId !== ownerId) throw new ForbiddenException('Not the owner');
    const ownerAllowed: readonly ListingStatus[] = [
      'active',
      'reserved',
      'paused',
      'completed',
      'archived',
    ];
    if (!ownerAllowed.includes(to)) throw new ForbiddenException(`Owners cannot set status ${to}`);
    if (!canTransition(row.status, to)) {
      throw new UnprocessableEntityException(
        `Cannot transition listing from ${row.status} to ${to}`,
      );
    }
    const renew = to === 'active' && (row.status === 'expired' || row.expiresAt <= new Date());
    const updated = await this.prisma.listing.update({
      where: { id, version: row.version },
      data: {
        status: to,
        version: { increment: 1 },
        ...(renew
          ? {
              expiresAt: new Date(Date.now() + DEFAULT_LISTING_TTL_DAYS[row.type] * 86_400_000),
              publishedAt: new Date(),
            }
          : {}),
      },
      include: listingInclude,
    });
    return toListingDetail(updated);
  }

  /** Marks stale active/reserved listings as expired. Intended for a scheduler; also safe to call ad hoc. */
  async expireStale(now = new Date()): Promise<number> {
    const res = await this.prisma.listing.updateMany({
      where: { status: { in: ['active', 'reserved', 'paused'] }, expiresAt: { lte: now } },
      data: { status: 'expired' },
    });
    return res.count;
  }
}
