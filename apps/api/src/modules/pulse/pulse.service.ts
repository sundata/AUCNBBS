import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { fetchFeed } from '../weekend/feed-fetch';
import { screenText } from '../../common/risk';
import { ADAPTERS } from './pulse.adapters';
import {
  feedSourceInput,
  fingerprint,
  parseJsonFeed,
  parseNewsFeed,
  titleHash,
  translateToZh,
} from './pulse.helpers';

/** Digest editions per Australia/Sydney day — morning / midday / evening. */
const DIGEST_EDITIONS = [
  { key: 'morning', at: 7 * 60 + 30, zh: '晨报', en: 'Morning Briefing' },
  { key: 'midday', at: 12 * 60, zh: '午报', en: 'Midday Briefing' },
  { key: 'evening', at: 18 * 60, zh: '晚报', en: 'Evening Briefing' },
] as const;

type DigestEdition = (typeof DIGEST_EDITIONS)[number];

@Injectable()
export class PulseService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private readonly logger = new Logger(PulseService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.PULSE_COLLECTOR_ENABLED !== 'true') return;
    try {
      const sources = z
        .array(feedSourceInput)
        .max(40)
        .parse(JSON.parse(process.env.PULSE_SOURCES_JSON ?? '[]'));
      const ids = sources.map((s) => s.id);
      await this.prisma.feedSource.updateMany({
        where: { id: { notIn: ids } },
        data: { enabled: false },
      });
      for (const source of sources)
        await this.prisma.feedSource.upsert({
          where: { id: source.id },
          create: source,
          update: source,
        });
      void this.tick();
      this.timer = setInterval(() => void this.tick(), 60_000);
      this.timer.unref();
    } catch {
      this.logger.error('Pulse collector disabled: invalid configuration or unavailable database');
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Claim a due source, run it, then record success/backoff. Shared lease pattern. */
  private async runSource(source: {
    id: string;
    url: string;
    format: string;
    category: string;
    cityId: string | null;
    name: string;
    autoPublish: boolean;
    intervalMinutes: number;
    failures: number;
  }) {
    const leaseUntil = new Date(Date.now() + 120000);
    const claimed = await this.prisma.feedSource.updateMany({
      where: {
        id: source.id,
        enabled: true,
        nextRunAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseUntil, lastRunAt: new Date() },
    });
    if (!claimed.count) return;
    try {
      const count = await this.collect(source);
      await this.prisma.feedSource.updateMany({
        where: { id: source.id, leaseUntil },
        data: {
          leaseUntil: null,
          lastSuccessAt: new Date(),
          lastError: null,
          failures: 0,
          lastCount: count,
          nextRunAt: new Date(Date.now() + source.intervalMinutes * 60000),
        },
      });
    } catch (error) {
      await this.prisma.feedSource.updateMany({
        where: { id: source.id, leaseUntil },
        data: {
          leaseUntil: null,
          lastError: error instanceof Error ? error.message.slice(0, 300) : 'Collection failed',
          failures: { increment: 1 },
          nextRunAt: new Date(
            Date.now() +
              Math.min(1440, source.intervalMinutes * Math.pow(2, Math.min(source.failures, 5))) *
                60000,
          ),
        },
      });
    }
  }

  private async collect(source: {
    id: string;
    url: string;
    format: string;
    category: string;
    cityId: string | null;
    name: string;
    autoPublish: boolean;
  }): Promise<number> {
    const adapter = ADAPTERS[source.format];
    if (adapter) {
      const { metrics = [], items = [] } = await adapter(source.url);
      for (const m of metrics)
        await this.prisma.pulseMetric.create({
          data: {
            kind: m.kind,
            cityId: source.cityId,
            payload: m.payload as Prisma.InputJsonValue,
          },
        });
      if (items.length) await this.importItems(source, items);
      return metrics.length + items.length;
    }
    const body = await fetchFeed(source.url);
    const items = source.format === 'json' ? parseJsonFeed(body) : parseNewsFeed(body);
    return this.importItems(source, items);
  }

  private async importItems(
    source: {
      id: string;
      category: string;
      cityId: string | null;
      name: string;
      autoPublish: boolean;
    },
    items: {
      title: string;
      summary: string;
      sourceUrl: string;
      imageUrl: string | null;
      publishedAt: string | null;
    }[],
  ): Promise<number> {
    let imported = 0;
    for (const item of items) {
      const fp = fingerprint(item.sourceUrl);
      const th = titleHash(item.title);
      const exists = await this.prisma.feedItem.findFirst({
        where: {
          OR: [{ fingerprint: fp }, { title: item.title }, ...(th ? [{ titleHash: th }] : [])],
        },
        select: {
          id: true,
          cityId: true,
          title: true,
          titleZh: true,
          summary: true,
          summaryZh: true,
        },
      });
      if (exists) {
        const patch: Prisma.FeedItemUpdateInput = {};
        // Same syndicated article via another city's feed — broaden it to national.
        if (exists.cityId && exists.cityId !== source.cityId) patch.cityId = null;
        // Self-heal: earlier items imported before translation was enabled.
        if (!exists.titleZh) patch.titleZh = await translateToZh(exists.title);
        if (!exists.summaryZh && exists.summary)
          patch.summaryZh = await translateToZh(exists.summary);
        if (Object.keys(patch).length)
          await this.prisma.feedItem.update({ where: { id: exists.id }, data: patch });
        continue;
      }
      const flags = await screenText(this.prisma, `${item.title}\n${item.summary}`);
      // Trusted structured sources publish directly; everything else needs a clean
      // risk scan AND source.autoPublish, otherwise it waits in the review queue.
      const publish = source.autoPublish && flags.length === 0;
      const [titleZh, summaryZh] = await Promise.all([
        translateToZh(item.title),
        item.summary ? translateToZh(item.summary) : Promise.resolve(null),
      ]);
      await this.prisma.feedItem.create({
        data: {
          fingerprint: fp,
          titleHash: th,
          sourceId: source.id,
          category: source.category,
          cityId: source.cityId,
          title: item.title,
          titleZh,
          summary: item.summary,
          summaryZh,
          imageUrl: item.imageUrl,
          sourceName: source.name,
          sourceUrl: item.sourceUrl,
          riskFlags: flags,
          status: publish ? 'published' : 'pending',
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
        },
      });
      imported++;
    }
    return imported;
  }

  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const now = new Date();
      const sources = await this.prisma.feedSource.findMany({
        where: {
          enabled: true,
          nextRunAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        orderBy: { nextRunAt: 'asc' },
        take: 10,
      });
      for (const source of sources) {
        if (this.stopped) break;
        await this.runSource(source);
      }
      await this.maybeWriteDigest();
      await this.maybeWriteTopic();
    } catch {
      this.logger.error('Pulse collection failed; retrying next minute');
    } finally {
      this.running = false;
    }
  }

  private sydneyParts(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    return Object.fromEntries(parts.map((v) => [v.type, v.value]));
  }

  /** Morning/midday/evening digest articles per Sydney day — SEO + retention hook. */
  async maybeWriteDigest(now = new Date()) {
    const p = this.sydneyParts(now);
    const minutes = Number(p.hour) * 60 + Number(p.minute);
    const day = `${p.year}-${p.month}-${p.day}`;
    for (const edition of DIGEST_EDITIONS) {
      if (minutes < edition.at) continue;
      for (const locale of ['zh'] as const) {
        const slug = `daily-${day}-${edition.key}-${locale}`;
        const exists = await this.prisma.article.findUnique({
          where: { slug },
          select: { id: true },
        });
        if (exists) continue;
        const article = await this.buildDigest(day, edition, locale);
        if (!article) return;
        await this.prisma.article.create({
          data: { slug, authorId: article.authorId, locale, ...article.data },
        });
      }
    }
  }

  /**
   * One community discussion thread per Sydney day built on the freshest
   * collected item — gives the boards a daily conversation starter.
   */
  async maybeWriteTopic(now = new Date()) {
    const p = this.sydneyParts(now);
    if (Number(p.hour) * 60 + Number(p.minute) < 7 * 60) return;
    const day = `${p.year}-${p.month}-${p.day}`;
    const key = `last_topic_day`;
    const cfg = await this.prisma.appConfig.findUnique({ where: { key } });
    if (cfg?.value === day) return;
    const [board, item] = await Promise.all([
      this.prisma.board.findFirst({
        orderBy: [{ isCityBoard: 'asc' }, { sortOrder: 'asc' }],
        select: { id: true },
      }),
      this.prisma.feedItem.findFirst({
        where: { status: 'published', category: { in: ['news', 'event', 'deal'] } },
        orderBy: { publishedAt: 'desc' },
      }),
    ]);
    if (!board || !item) return;
    const title = item.titleZh ?? item.title;
    const summary = item.summaryZh ?? item.summary;
    await this.prisma.$transaction(async (tx) => {
      await tx.post.create({
        data: {
          boardId: board.id,
          authorId: await this.digestAuthorId(),
          title: `每日话题｜${title}`.slice(0, 120),
          body:
            `${summary ? summary + '\n\n' : ''}原文：${item.sourceName} — ${item.sourceUrl}\n\n` +
            `大家怎么看？欢迎在评论区聊聊。`,
        },
      });
      await tx.appConfig.upsert({
        where: { key },
        create: { key, value: day },
        update: { value: day },
      });
    });
  }

  private async digestAuthorId() {
    const cfg = await this.prisma.appConfig.findUnique({ where: { key: 'digest_author_id' } });
    if (typeof cfg?.value === 'string') return cfg.value;
    const author = await this.prisma.user.create({
      data: { displayName: 'AUCN 编辑部', role: 'editor', locale: 'zh' },
    });
    await this.prisma.appConfig.upsert({
      where: { key: 'digest_author_id' },
      create: { key: 'digest_author_id', value: author.id },
      update: { value: author.id },
    });
    return author.id;
  }

  private async buildDigest(day: string, edition: DigestEdition, locale: 'zh' | 'en') {
    const zh = locale === 'zh';
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400000);
    const [rate, weather, events, posts, listings, items] = await Promise.all([
      this.prisma.pulseMetric.findFirst({
        where: { kind: 'exchange_rate' },
        orderBy: { observedAt: 'desc' },
      }),
      this.prisma.pulseMetric.findMany({
        where: { kind: 'weather' },
        orderBy: { observedAt: 'desc' },
        distinct: ['cityId'],
        take: 4,
      }),
      this.prisma.weekendEvent.findMany({
        where: { status: 'published', endsAt: { gt: now } },
        orderBy: { startsAt: 'asc' },
        take: 5,
      }),
      this.prisma.post.findMany({
        where: { createdAt: { gt: dayAgo }, status: 'published' },
        orderBy: [{ commentCount: 'desc' }, { viewCount: 'desc' }],
        take: 5,
      }),
      this.prisma.listing.count({
        where: { status: 'active', createdAt: { gt: dayAgo } },
      }),
      this.prisma.feedItem.findMany({
        where: { status: 'published', publishedAt: { gt: dayAgo } },
        orderBy: { publishedAt: 'desc' },
        take: 5,
      }),
    ]);
    const rateLine = rate
      ? (() => {
          const r = (rate.payload as { rates?: Record<string, number> }).rates ?? {};
          return r.CNY ? `1 AUD = ${r.CNY} CNY` : null;
        })()
      : null;
    const lines: string[] = [];
    if (rateLine) lines.push(zh ? `💱 汇率：${rateLine}` : `💱 FX: ${rateLine}`);
    for (const w of weather) {
      const c = (w.payload as { current?: { temp?: number; code?: number } }).current;
      if (c?.temp != null) lines.push(zh ? `🌡️ 气温 ${c.temp}°C` : `🌡️ ${c.temp}°C`);
    }
    if (events.length)
      lines.push(
        zh ? `🎉 近期活动 ${events.length} 个：${events.map((e) => e.title).join('；')}` : '',
      );
    if (posts.length)
      lines.push(
        zh
          ? `🔥 昨日热帖：${posts.map((p2) => p2.title).join('；')}`
          : `🔥 Trending: ${posts.map((p2) => p2.title).join('; ')}`,
      );
    if (listings) lines.push(zh ? `🆕 昨日新增信息 ${listings} 条` : `🆕 ${listings} new listings`);
    if (items.length)
      lines.push(
        zh
          ? `📰 本地动态：${items.map((i) => i.titleZh ?? i.title).join('；')}`
          : `📰 Local: ${items.map((i) => i.title).join('; ')}`,
      );
    if (!lines.length) return null;
    const authorId = await this.digestAuthorId();
    return {
      authorId,
      data: {
        category: 'daily_digest',
        title: zh ? `澳中生活圈${edition.zh} ${day}` : `AUCN ${edition.en} ${day}`,
        summary: zh
          ? `${day} ${edition.zh}：汇率、天气、活动与社区热点速览`
          : `${day} ${edition.en.toLowerCase()}: rates, weather, events and community highlights`,
        body: lines.join('\n\n'),
        status: 'published' as const,
        publishedAt: now,
      },
    };
  }
}
