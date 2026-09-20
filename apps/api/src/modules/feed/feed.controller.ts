import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ListingType } from '@aucn/domain';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import {
  listingInclude,
  ListingSummaryDto,
  publicListingWhere,
  toListingSummary,
} from '../listings/listings.service';
import { PrismaService } from '../prisma/prisma.service';

const feedQuerySchema = z.object({ cityId: z.string().uuid().optional() });

export interface HomeFeedDto {
  city: { id: string; slug: string; nameZh: string; nameEn: string } | null;
  headlines: {
    id: string;
    slug: string;
    category: string;
    title: string;
    summary: string;
    coverUrl: string | null;
    publishedAt: string | null;
  }[];
  features: {
    id: string;
    slug: string;
    title: string;
    summary: string;
    coverUrl: string | null;
  }[];
  hotPosts: {
    id: string;
    boardSlug: string;
    title: string;
    commentCount: number;
    lastActiveAt: string;
  }[];
  listings: Record<ListingType, ListingSummaryDto[]>;
}

@ApiTags('feed')
@Controller({ path: 'feed', version: '1' })
export class FeedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('home')
  async home(
    @Query(new ZodPipe(feedQuerySchema)) query: z.infer<typeof feedQuerySchema>,
  ): Promise<HomeFeedDto> {
    const cityFilter = query.cityId ? { cityId: query.cityId } : {};
    const [city, articles, features, posts, ...perType] = await Promise.all([
      query.cityId
        ? this.prisma.city.findUnique({
            where: { id: query.cityId },
            select: { id: true, slug: true, nameZh: true, nameEn: true },
          })
        : Promise.resolve(null),
      this.prisma.article.findMany({
        where: { status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: 6,
      }),
      this.prisma.article.findMany({
        where: { status: 'published', coverUrl: { not: null } },
        orderBy: { publishedAt: 'desc' },
        take: 4,
        select: { id: true, slug: true, title: true, summary: true, coverUrl: true },
      }),
      this.prisma.post.findMany({
        where: {
          status: 'published',
          ...(query.cityId ? { OR: [{ cityId: query.cityId }, { cityId: null }] } : {}),
        },
        orderBy: [{ pinned: 'desc' }, { lastActiveAt: 'desc' }],
        take: 8,
        include: { board: { select: { slug: true } } },
      }),
      ...(['housing', 'job', 'item', 'service'] as const).map((type) =>
        this.prisma.listing.findMany({
          where: { ...publicListingWhere(), type, ...cityFilter },
          orderBy: { publishedAt: 'desc' },
          take: 6,
          include: listingInclude,
        }),
      ),
    ]);
    const [housing, job, item, service] = perType;
    return {
      city,
      headlines: articles.map((a) => ({
        id: a.id,
        slug: a.slug,
        category: a.category,
        title: a.title,
        summary: a.summary,
        coverUrl: a.coverUrl,
        publishedAt: a.publishedAt?.toISOString() ?? null,
      })),
      features,
      hotPosts: posts.map((p) => ({
        id: p.id,
        boardSlug: p.board.slug,
        title: p.title,
        commentCount: p.commentCount,
        lastActiveAt: p.lastActiveAt.toISOString(),
      })),
      listings: {
        housing: housing.map(toListingSummary),
        job: job.map(toListingSummary),
        item: item.map(toListingSummary),
        service: service.map(toListingSummary),
      },
    };
  }
}
