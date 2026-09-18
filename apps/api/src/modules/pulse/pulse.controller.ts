import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  ConflictException,
  Param,
  Patch,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessTokenPayload } from '../auth/auth.service';
import { ZodPipe } from '../../common/zod.pipe';
import { FEED_CATEGORIES, feedReviewInput, feedSourceInput } from './pulse.helpers';

function editor(u: AccessTokenPayload) {
  if (!['editor', 'admin', 'super_admin'].includes(u.role)) throw new ForbiddenException();
}

const feedQuery = z.object({
  category: z.enum(FEED_CATEGORIES).optional(),
  city: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

@Controller({ path: 'pulse', version: '1' })
export class PulseController {
  constructor(private readonly prisma: PrismaService) {}

  /** Daily-visit hook: FX, weather, fuel, alerts, today's events and community heat. */
  @Get('dashboard')
  async dashboard(@Query('city') citySlug?: string) {
    const city = citySlug ? await this.prisma.city.findUnique({ where: { slug: citySlug } }) : null;
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400000);
    const [metrics, alerts, events, hotPosts, newListings, news] = await Promise.all([
      this.prisma.pulseMetric.findMany({
        where: {
          OR: [{ cityId: null }, ...(city ? [{ cityId: city.id }] : [])],
        },
        orderBy: { observedAt: 'desc' },
        distinct: ['kind', 'cityId'],
        take: 20,
      }),
      this.prisma.feedItem.findMany({
        where: {
          status: 'published',
          category: 'notice',
          publishedAt: { gt: new Date(now.getTime() - 3 * 86400000) },
        },
        orderBy: { publishedAt: 'desc' },
        take: 5,
      }),
      this.prisma.weekendEvent.findMany({
        where: {
          status: 'published',
          endsAt: { gt: now },
          ...(city ? { cityId: city.id } : {}),
        },
        orderBy: { startsAt: 'asc' },
        take: 5,
      }),
      this.prisma.post.findMany({
        where: { status: 'published', lastActiveAt: { gt: dayAgo } },
        orderBy: [{ commentCount: 'desc' }, { viewCount: 'desc' }],
        take: 5,
        select: { id: true, title: true, commentCount: true, viewCount: true },
      }),
      this.prisma.listing.count({ where: { status: 'active', createdAt: { gt: dayAgo } } }),
      this.prisma.feedItem.findMany({
        where: { status: 'published', category: { not: 'notice' } },
        orderBy: { publishedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          category: true,
          title: true,
          titleZh: true,
          sourceName: true,
          sourceUrl: true,
          publishedAt: true,
        },
      }),
    ]);
    return {
      city: city ? { slug: city.slug, nameZh: city.nameZh, nameEn: city.nameEn } : null,
      metrics: metrics.map((m) => ({
        kind: m.kind,
        cityId: m.cityId,
        payload: m.payload,
        observedAt: m.observedAt,
      })),
      alerts,
      events,
      hotPosts,
      newListings,
      news,
      generatedAt: now,
    };
  }

  /** Public feed of collected news/deals/guides/notices. */
  @Get('feed')
  async feed(@Query(new ZodPipe(feedQuery)) q: z.infer<typeof feedQuery>) {
    const city = q.city ? await this.prisma.city.findUnique({ where: { slug: q.city } }) : null;
    const where = {
      status: 'published',
      ...(q.category ? { category: q.category } : {}),
      ...(city ? { OR: [{ cityId: city.id }, { cityId: null }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.feedItem.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * 20,
        take: 20,
      }),
      this.prisma.feedItem.count({ where }),
    ]);
    return { items, total, page: q.page };
  }

  // ---------- Admin: sources + review queue ----------

  @Get('admin/sources')
  @UseGuards(AuthGuard)
  async sources(@CurrentUser() u: AccessTokenPayload) {
    editor(u);
    return {
      enabled: process.env.PULSE_COLLECTOR_ENABLED === 'true',
      items: await this.prisma.feedSource.findMany({ orderBy: { id: 'asc' } }),
    };
  }

  @Get('admin/items')
  @UseGuards(AuthGuard)
  async pending(
    @CurrentUser() u: AccessTokenPayload,
    @Query(
      new ZodPipe(
        z.object({
          status: z.enum(['pending', 'published', 'rejected']).default('pending'),
          page: z.coerce.number().int().min(1).max(1000).default(1),
        }),
      ),
    )
    q: { status: string; page: number },
  ) {
    editor(u);
    const where = { status: q.status };
    return {
      items: await this.prisma.feedItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * 20,
        take: 20,
      }),
      total: await this.prisma.feedItem.count({ where }),
    };
  }

  @Patch('admin/items/:id')
  @UseGuards(AuthGuard)
  async review(
    @CurrentUser() u: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(feedReviewInput)) body: z.infer<typeof feedReviewInput>,
  ) {
    editor(u);
    const { updatedAt, status, title, summary } = body;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.feedItem.updateMany({
        where: { id, updatedAt: new Date(updatedAt) },
        data: {
          title,
          summary,
          status,
          reviewedAt: new Date(),
          ...(status === 'published' ? { publishedAt: new Date() } : {}),
        },
      });
      if (!result.count) throw new ConflictException('Item changed; reload before saving');
      await tx.auditLog.create({
        data: { actorId: u.sub, action: `pulse.${status}`, subject: id },
      });
      return tx.feedItem.findUniqueOrThrow({ where: { id } });
    });
  }

  @Patch('admin/sources/:id')
  @UseGuards(AuthGuard)
  async updateSource(
    @CurrentUser() u: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodPipe(feedSourceInput.partial())) body: Partial<z.infer<typeof feedSourceInput>>,
  ) {
    editor(u);
    const existing = await this.prisma.feedSource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    const data = { ...body };
    delete data.id;
    return this.prisma.feedSource.update({ where: { id }, data });
  }
}
