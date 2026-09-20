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
import { sourceHealth } from '../../common/source-health';
import { FEED_CATEGORIES, aiBrief, feedReviewInput, feedSourceInput } from './pulse.helpers';
import { cityLocations } from '../../common/extract';

function editor(u: AccessTokenPayload) {
  if (!['editor', 'admin', 'super_admin'].includes(u.role)) throw new ForbiddenException();
}

const feedQuery = z.object({
  category: z.enum(FEED_CATEGORIES).optional(),
  city: z.string().trim().max(60).optional(),
  q: z.string().trim().max(200).optional(), // 'a|b|c' matches any keyword
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
    const keywords = q.q?.split('|').filter(Boolean) ?? [];
    const where = {
      status: 'published',
      ...(q.category ? { category: q.category } : {}),
      AND: [
        ...(city
          ? [
              // Collected posts rarely carry cityId; the extracted `location`
              // is the real signal. Include unlocated posts as national.
              {
                OR: [
                  { cityId: city.id },
                  { location: { in: cityLocations(city.nameEn) } },
                  { AND: [{ cityId: null }, { location: null }] },
                ],
              },
            ]
          : []),
        ...(keywords.length
          ? [
              {
                OR: keywords.flatMap((k) => [
                  { title: { contains: k, mode: 'insensitive' as const } },
                  { summary: { contains: k, mode: 'insensitive' as const } },
                  { titleZh: { contains: k, mode: 'insensitive' as const } },
                ]),
              },
            ]
          : []),
      ],
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

  /**
   * On-site detail page for a collected item. Generates a lazily-cached AI
   * reading note so visitors get real content here instead of a bare
   * outbound link; the source stays as attribution.
   */
  @Get('feed/:id')
  async feedItem(@Param('id', ParseUUIDPipe) id: string) {
    const item = await this.prisma.feedItem.findFirst({
      where: { id, status: 'published' },
    });
    if (!item) throw new NotFoundException();
    let brief = item.brief;
    if (!brief) {
      brief = await aiBrief(
        `你是澳洲华人生活平台的编辑。把下面这条社区帖子改写成 80-150 字的中文导读：` +
          `一句话说清是什么事/什么信息，点出价格、地点、时间等关键信息；语气客观简洁，` +
          `不要夸张、不要编造原文没有的细节、不要复述标题。\n\n标题：${item.title}\n内容：${item.summary || item.title}`,
      );
      if (brief)
        await this.prisma.feedItem.update({ where: { id: item.id }, data: { brief } });
    }
    const related = await this.prisma.feedItem.findMany({
      where: { status: 'published', category: item.category, id: { not: item.id } },
      orderBy: { publishedAt: 'desc' },
      take: 4,
      select: {
        id: true,
        title: true,
        titleZh: true,
        sourceName: true,
        publishedAt: true,
        priceCents: true,
        pricePeriod: true,
        location: true,
      },
    });
    return { ...item, brief, related };
  }

  /**
   * Original value-add: aggregate signals extracted from collected posts.
   * Median asking price this week vs last week, post volume, top locations.
   */
  @Get('insights')
  async insights(
    @Query(new ZodPipe(z.object({ category: z.enum(FEED_CATEGORIES).optional() })))
    q: { category?: string },
  ) {
    const now = Date.now();
    const weekMs = 7 * 86400000;
    const base = { status: 'published', ...(q.category ? { category: q.category } : {}) };
    const [cur, prev] = await Promise.all([
      this.prisma.feedItem.findMany({
        where: { ...base, publishedAt: { gt: new Date(now - weekMs) } },
        select: { priceCents: true, pricePeriod: true, location: true },
      }),
      this.prisma.feedItem.findMany({
        where: {
          ...base,
          publishedAt: { gt: new Date(now - 2 * weekMs), lte: new Date(now - weekMs) },
        },
        select: { priceCents: true },
      }),
    ]);
    const median = (nums: number[]) => {
      const s = [...nums].sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    const period = q.category === 'job' ? 'hour' : q.category === 'housing' ? 'week' : 'once';
    const curPrices = cur
      .filter((i) => i.priceCents && i.pricePeriod === period)
      .map((i) => i.priceCents as number);
    const prevPrices = prev.map((i) => i.priceCents).filter((v): v is number => v != null);
    const locations = new Map<string, number>();
    for (const i of cur)
      if (i.location) locations.set(i.location, (locations.get(i.location) ?? 0) + 1);
    const medianNow = median(curPrices);
    const medianPrev = median(prevPrices);
    return {
      category: q.category ?? 'all',
      period,
      windowDays: 7,
      count: cur.length,
      prevCount: prev.length,
      medianPriceCents: medianNow,
      prevMedianPriceCents: medianPrev,
      deltaPct:
        medianNow != null && medianPrev
          ? Math.round(((medianNow - medianPrev) / medianPrev) * 1000) / 10
          : null,
      topLocations: [...locations.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => ({ name, count })),
    };
  }

  // ---------- Admin: sources + review queue ----------

  @Get('admin/sources')
  @UseGuards(AuthGuard)
  async sources(@CurrentUser() u: AccessTokenPayload) {
    editor(u);
    const items = await this.prisma.feedSource.findMany({ orderBy: { id: 'asc' } });
    return {
      enabled: process.env.PULSE_COLLECTOR_ENABLED === 'true',
      items: items.map((s) => ({ ...s, health: sourceHealth(s) })),
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
