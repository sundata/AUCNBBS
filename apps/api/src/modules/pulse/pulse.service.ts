import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { fetchFeed } from '../weekend/feed-fetch';
import { screenText } from '../../common/risk';
import { extractLocation, extractPrice } from '../../common/extract';
import { ADAPTERS } from './pulse.adapters';
import {
  feedSourceInput,
  fingerprint,
  parseJsonFeed,
  parseNewsFeed,
  titleHash,
  translateToZh,
  aiBrief,
  fetchAuTrends,
  pexelsPhotos,
} from './pulse.helpers';

/** Digest editions per Australia/Sydney day — morning / midday / evening. */
const DIGEST_EDITIONS = [
  { key: 'morning', at: 7 * 60 + 30, zh: '晨报', en: 'Morning Briefing' },
  { key: 'midday', at: 12 * 60, zh: '午报', en: 'Midday Briefing' },
  { key: 'evening', at: 18 * 60, zh: '晚报', en: 'Evening Briefing' },
] as const;

type DigestEdition = (typeof DIGEST_EDITIONS)[number];

/** Weekly market briefs generated from extracted price signals. */
const BRIEF_CATEGORIES = [
  { category: 'housing', period: 'week', zh: '租房', label: '中位周租', unit: '/周' },
  { category: 'job', period: 'hour', zh: '招工', label: '中位时薪', unit: '/小时' },
  { category: 'market', period: 'once', zh: '二手', label: '中位要价', unit: '' },
] as const;

/** Daily illustrated feature topics — rotated by day-of-year so every day differs. */
const FEATURE_TOPICS = [
  { topic: '澳元汇率、换汇时机与一周生活成本', hint: 'Australian money currency' },
  { topic: '周末亲子活动与免费遛娃好去处', hint: 'Sydney family park weekend' },
  { topic: '华人区租房市场行情与看房避坑', hint: 'apartment building rent' },
  { topic: '澳洲通勤、驾照换算与出行贴士', hint: 'Australia train station commute' },
  { topic: '华人超市采购与地道家乡味', hint: 'Asian grocery market food' },
  { topic: '求职招工行情与面试实用技巧', hint: 'office job interview' },
  { topic: '二手捡漏与闲置交易攻略', hint: 'weekend garage sale market' },
  { topic: '中澳文化差异与本地社交礼仪', hint: 'Australia lifestyle friends cafe' },
  { topic: '当季天气穿衣指南与户外出行', hint: 'Australia beach coastline' },
  { topic: '留学生与新移民落地生活指南', hint: 'Sydney city street students' },
] as const;

/** Two feature slots per Sydney day — morning and late afternoon, distinct topics. */
const FEATURE_SLOTS = [
  { suffix: 'a', at: 9 * 60 + 30, topicOffset: 0 },
  { suffix: 'b', at: 16 * 60 + 30, topicOffset: 3 },
] as const;

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
      const signal = `${item.title}\n${item.summary}`;
      const flags = await screenText(this.prisma, signal);
      // Free-ad boards are nearly all promo posts; flag-priced ads are rejected
      // outright so the review queue is not buried under them.
      const autoReject =
        source.category === 'service' && flags.includes('too_good_price');
      // Trusted structured sources publish directly; everything else needs a clean
      // risk scan AND source.autoPublish, otherwise it waits in the review queue.
      const publish = source.autoPublish && flags.length === 0;
      const [titleZh, summaryZh] = await Promise.all([
        translateToZh(item.title),
        item.summary ? translateToZh(item.summary) : Promise.resolve(null),
      ]);
      const price = extractPrice(signal);
      const location = extractLocation(signal);
      await this.prisma.feedItem.create({
        data: {
          fingerprint: fp,
          titleHash: th,
          sourceId: source.id,
          category: source.category,
          cityId: source.cityId,
          priceCents: price?.cents ?? null,
          pricePeriod: price?.period ?? null,
          location,
          title: item.title,
          titleZh,
          summary: item.summary,
          summaryZh,
          imageUrl: item.imageUrl,
          sourceName: source.name,
          sourceUrl: item.sourceUrl,
          riskFlags: flags,
          status: autoReject ? 'rejected' : publish ? 'published' : 'pending',
          reviewedAt: autoReject ? new Date() : null,
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
      await this.maybeWriteBrief();
      await this.maybeWriteFeature();
      await this.maybeWriteHotFeature();
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

  /**
   * Sunday-evening weekly brief per price-bearing category. The brief is the
   * original product: stats aggregated from extracted signals plus notable
   * posts, optionally rewritten into prose by an LLM when configured.
   */
  async maybeWriteBrief(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
    if (p.weekday !== 'Sun' || Number(p.hour) * 60 + Number(p.minute) < 18 * 60) return;
    // Key the week by its Sydney Monday so the slug is stable and idempotent.
    const date = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 6);
    const weekKey = date.toISOString().slice(0, 10);
    for (const spec of BRIEF_CATEGORIES) {
      const slug = `brief-${spec.category}-w${weekKey}-zh`;
      const exists = await this.prisma.article.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (exists) continue;
      const brief = await this.buildBrief(spec, weekKey);
      if (!brief) continue;
      await this.prisma.article.create({
        data: {
          slug,
          authorId: await this.digestAuthorId(),
          locale: 'zh',
          category: 'weekly_brief',
          title: brief.title,
          summary: brief.summary,
          body: brief.body,
          status: 'published',
          publishedAt: now,
        },
      });
    }
  }

  private async buildBrief(
    spec: (typeof BRIEF_CATEGORIES)[number],
    weekKey: string,
  ): Promise<{ title: string; summary: string; body: string } | null> {
    const now = Date.now();
    const weekMs = 7 * 86400000;
    const items = await this.prisma.feedItem.findMany({
      where: {
        status: 'published',
        category: spec.category,
        publishedAt: { gt: new Date(now - weekMs) },
      },
      orderBy: { publishedAt: 'desc' },
      select: {
        title: true,
        titleZh: true,
        sourceName: true,
        sourceUrl: true,
        priceCents: true,
        pricePeriod: true,
        location: true,
      },
      take: 200,
    });
    if (items.length < 3) return null;
    const priced = items.filter((i) => i.priceCents && i.pricePeriod === spec.period);
    const prev = await this.prisma.feedItem.findMany({
      where: {
        status: 'published',
        category: spec.category,
        pricePeriod: spec.period,
        priceCents: { not: null },
        publishedAt: { gt: new Date(now - 2 * weekMs), lte: new Date(now - weekMs) },
      },
      select: { priceCents: true },
    });
    const median = (nums: number[]) => {
      const s = [...nums].sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    const med = median(priced.map((i) => i.priceCents as number));
    const prevMed = median(prev.map((i) => i.priceCents as number));
    const delta =
      med != null && prevMed ? Math.round(((med - prevMed) / prevMed) * 1000) / 10 : null;
    const locs = new Map<string, number>();
    for (const i of items) if (i.location) locs.set(i.location, (locs.get(i.location) ?? 0) + 1);
    const topLocs = [...locs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const dollars = med != null ? `$${Math.round(med / 100)}` : null;
    const deltaText = delta != null ? `，环比 ${delta > 0 ? '+' : ''}${delta}%` : '';
    const locText = topLocs.length
      ? `热门区域：${topLocs.map(([n, c]) => `${n}（${c} 条）`).join('、')}。`
      : '';
    const notable = items
      .filter((i) => i.priceCents || i.location)
      .slice(0, 5)
      .map((i) => {
        const price = i.priceCents
          ? `$${Math.round(i.priceCents / 100)}${i.pricePeriod === 'week' ? '/周' : i.pricePeriod === 'hour' ? '/小时' : i.pricePeriod === 'day' ? '/天' : ''}`
          : '';
        return `- ${i.titleZh ?? i.title} ${price ? `｜${price}` : ''}｜${i.sourceName} ${i.sourceUrl}`;
      });
    const statsText =
      `本周（${weekKey} 起）${spec.zh}板块共采集到 ${items.length} 条新帖` +
      (dollars ? `，${spec.label} ${dollars}${spec.unit}${deltaText}` : '') +
      `。${locText}`;
    const ai = await aiBrief(
      `你是澳洲华人生活平台的市场编辑。根据以下本周${spec.zh}板块数据，写一段 120-200 字的中文周报，` +
        `语气实用、客观，不要夸大，不要编造数据之外的细节。结尾提醒读者交易前自行核实。\n\n` +
        `${statsText}\n值得关注的帖子：\n${notable.join('\n')}`,
    );
    const body = ai
      ? `${ai}\n\n值得关注的帖子：\n${notable.join('\n')}\n\n数据来源：自动统计自社区公开帖子，仅供参考。`
      : `${statsText}\n\n值得关注的帖子：\n${notable.join('\n')}\n\n数据来源：自动统计自社区公开帖子，仅供参考，交易前请自行核实。`;
    return {
      title: `本周${spec.zh}行情｜${dollars ? `${spec.label} ${dollars}${spec.unit}` : `${items.length} 条新帖`}`,
      summary: statsText.slice(0, 120),
      body,
    };
  }

  /**
   * Daily illustrated feature — the LLM synthesises today's collected signals
   * into an original magazine piece. Cover is a real photo via Pexels when a
   * key is configured, otherwise a generated branded SVG. Two slots per Sydney
   * day (morning + late afternoon) on different rotated topics.
   */
  async maybeWriteFeature(now = new Date()) {
    const p = this.sydneyParts(now);
    const minutes = Number(p.hour) * 60 + Number(p.minute);
    const day = `${p.year}-${p.month}-${p.day}`;
    for (const slot of FEATURE_SLOTS) {
      if (minutes < slot.at) continue;
      const slug = `feature-${day}-${slot.suffix}-zh`;
      const exists = await this.prisma.article.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (exists) continue;
      const feature = await this.buildFeature(day, slug, slot.topicOffset);
      if (!feature) continue;
      await this.prisma.article.create({
        data: {
          slug,
          authorId: await this.digestAuthorId(),
          locale: 'zh',
          category: 'ai_feature',
          status: 'published',
          publishedAt: now,
          ...feature,
        },
      });
    }
  }

  private async buildFeature(
    day: string,
    slug: string,
    topicOffset = 0,
  ): Promise<{ title: string; summary: string; body: string; coverUrl: string; source: string } | null> {
    const dayIdx =
      (Math.floor(
        (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${day.slice(0, 4)}-01-01T00:00:00Z`)) /
          86400000,
      ) +
        topicOffset) %
      FEATURE_TOPICS.length;
    const spec = FEATURE_TOPICS[dayIdx];
    const [rate, weather, items, signals, cities] = await Promise.all([
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
      this.prisma.feedItem.findMany({
        where: { status: 'published', publishedAt: { gt: new Date(Date.now() - 3 * 86400000) } },
        orderBy: { publishedAt: 'desc' },
        select: { title: true, titleZh: true, category: true, priceCents: true, pricePeriod: true, location: true },
        take: 12,
      }),
      this.weeklySignals(),
      this.prisma.city.findMany({ select: { id: true, nameZh: true } }),
    ]);
    const cityName = new Map(cities.map((c) => [c.id, c.nameZh]));
    const r = (rate?.payload as { rates?: Record<string, number> } | undefined)?.rates ?? {};
    const context: string[] = [];
    const rateParts = (['CNY', 'JPY', 'USD'] as const)
      .filter((c) => r[c])
      .map((c) => `${r[c]} ${c}`);
    if (rateParts.length) context.push(`今日汇率：1 AUD = ${rateParts.join('，')}`);
    for (const w of weather) {
      const p2 = w.payload as { temp?: number; code?: number };
      const name = w.cityId ? cityName.get(w.cityId) : null;
      if (name && p2.temp != null) context.push(`${name}天气：${p2.temp}°C`);
    }
    if (signals.rent) context.push(`本周采集租房帖中位周租 $${signals.rent}（${signals.rentCount} 条样本）`);
    if (signals.pay) context.push(`本周招工帖中位时薪 $${signals.pay}（${signals.payCount} 条样本）`);
    for (const i of items.slice(0, 8)) {
      const price = i.priceCents ? `（$${Math.round(i.priceCents / 100)}${i.pricePeriod === 'week' ? '/周' : i.pricePeriod === 'hour' ? '/小时' : ''}）` : '';
      context.push(`采集帖：${i.titleZh ?? i.title}${price}${i.location ? ` @${i.location}` : ''}`);
    }
    const raw = await aiBrief(
      `你是澳洲华人生活平台「澳中生活圈」的编辑。根据下面今天采集到的素材，围绕主题「${spec.topic}」写一篇生动的中文图文专栏。\n\n` +
        `严格输出 JSON（不要输出其他内容）：{"title": "...", "summary": "...", "body": "...", "imageQuery": "..."}\n` +
        `- title ≤ 22字，吸引人但不标题党\n` +
        `- summary ≤ 50字\n` +
        `- body 400-600字：开头一段引言，然后用 "## 小标题" 分 2-3 节，语气轻松实用，像跟读者聊天\n` +
        `- 可以引用素材里的数据（汇率、价格、地点），但不要编造素材之外的数字或事实\n` +
        `- imageQuery 为 2-4 个英文单词，用来搜索一张贴题的澳洲生活照片（例："Sydney harbour sunset"）\n\n` +
        `今日素材：\n${context.join('\n')}`,
      1800,
    );
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let doc: { title?: string; summary?: string; body?: string; imageQuery?: string };
    try {
      doc = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (!doc.title || !doc.body || doc.body.length < 200) return null;
    const illustrated = await this.illustrate(doc, slug, spec.hint);
    if (!illustrated) return null;
    return { ...illustrated, source: 'AUCN 精选画报' };
  }

  /**
   * Afternoon feature built on Australia's trending searches — the LLM picks
   * the one trend worth a Chinese-Australian reader's attention and writes a
   * short illustrated explainer around it.
   */
  async maybeWriteHotFeature(now = new Date()) {
    const p = this.sydneyParts(now);
    if (Number(p.hour) * 60 + Number(p.minute) < 13 * 60 + 30) return;
    const day = `${p.year}-${p.month}-${p.day}`;
    const slug = `hot-${day}-zh`;
    const exists = await this.prisma.article.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (exists) return;
    const trends = await fetchAuTrends().catch(() => []);
    if (!trends.length) return;
    const list = trends
      .map(
        (t, i) =>
          `${i + 1}. ${t.title}（搜索热度 ${t.traffic}）` +
          (t.news.length ? `｜相关新闻：${t.news.join('；')}` : ''),
      )
      .join('\n');
    const raw = await aiBrief(
      `你是澳洲华人生活平台「澳中生活圈」的编辑。下面是今天澳洲 Google 热搜榜：\n\n${list}\n\n` +
        `从中选出最值得澳洲华人关注的一条（与华人生活、中澳关系、民生、安全、移民留学、消费相关的优先；纯体育娱乐且与华人无关的跳过）。\n` +
        `围绕它写一篇 300-500字中文短文：开头一段点题，然后用 "## 小标题" 分 2 节，结合相关新闻说明发生了什么、对在澳华人有什么影响或看点。不要编造榜单之外的事实；信息不足时聚焦"为什么值得关注"。\n` +
        `严格输出 JSON（不要输出其他内容）：{"pick": 序号, "title": "≤22字", "summary": "≤50字", "body": "...", "imageQuery": "2-4个英文单词的搜图关键词"}\n` +
        `如果一条都不适合，输出 {"pick": null}`,
      1800,
    );
    const match = raw?.match(/\{[\s\S]*\}/);
    if (!match) return;
    let doc: { pick?: number | null; title?: string; summary?: string; body?: string; imageQuery?: string };
    try {
      doc = JSON.parse(match[0]);
    } catch {
      return;
    }
    if (doc.pick == null) return;
    const illustrated = await this.illustrate(doc, slug, trends[doc.pick - 1]?.title);
    if (!illustrated) return;
    await this.prisma.article.create({
      data: {
        slug,
        authorId: await this.digestAuthorId(),
        locale: 'zh',
        category: 'ai_feature',
        collection: 'hot',
        status: 'published',
        publishedAt: now,
        source: 'Google Trends 热搜',
        ...illustrated,
      },
    });
  }

  /**
   * Attach cover + optional inline photo to an LLM-written piece. Falls back
   * to the generated branded SVG cover when no stock photo is available.
   */
  private async illustrate(
    doc: { title?: string; summary?: string; body?: string; imageQuery?: string },
    slug: string,
    imageHint?: string,
  ): Promise<{ title: string; summary: string; body: string; coverUrl: string } | null> {
    if (!doc.title || !doc.body || doc.body.length < 200) return null;
    const photos = await pexelsPhotos(doc.imageQuery ?? imageHint ?? 'Australia');
    const cover = photos[0];
    const inline = photos[1];
    let body = doc.body.slice(0, 4000);
    if (inline) body = body.replace(/\n+(?=## )/, `\n\n![配图](${inline.url})\n\n`);
    const credits = [cover, inline]
      .filter((p): p is { url: string; credit: string } => !!p?.credit)
      .map((p) => p.credit);
    if (credits.length) body += `\n\n图片：${[...new Set(credits)].join('、')} / Pexels`;
    return {
      title: doc.title.slice(0, 60),
      summary: (doc.summary ?? doc.title).slice(0, 160),
      body,
      coverUrl:
        cover?.url ??
        `${process.env.API_PUBLIC_URL ?? 'http://localhost:4000'}/api/v1/articles/${slug}/cover.svg`,
    };
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

  /** Median asking rent / hourly pay extracted from last 14 days of collected posts. */
  private async weeklySignals() {
    const now = Date.now();
    const weekMs = 7 * 86400000;
    const median = (nums: number[]) => {
      const s = [...nums].sort((a, b) => a - b);
      return s.length ? Math.round(s[Math.floor(s.length / 2)] / 100) : null;
    };
    const prices = async (category: string, period: string, gt: Date, lte?: Date) =>
      (
        await this.prisma.feedItem.findMany({
          where: {
            status: 'published',
            category,
            pricePeriod: period,
            priceCents: { not: null },
            publishedAt: { gt, ...(lte ? { lte } : {}) },
          },
          select: { priceCents: true },
        })
      ).map((i) => i.priceCents as number);
    const [rentNow, rentPrev, payNow] = await Promise.all([
      prices('housing', 'week', new Date(now - weekMs)),
      prices('housing', 'week', new Date(now - 2 * weekMs), new Date(now - weekMs)),
      prices('job', 'hour', new Date(now - weekMs)),
    ]);
    const rent = median(rentNow);
    const rentPrevM = median(rentPrev);
    return {
      rent,
      rentCount: rentNow.length,
      rentDelta:
        rent != null && rentPrevM ? Math.round(((rent - rentPrevM) / rentPrevM) * 1000) / 10 : null,
      pay: median(payNow),
      payCount: payNow.length,
    };
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
          const parts = (['CNY', 'JPY', 'USD'] as const)
            .filter((c) => r[c])
            .map((c) => `${r[c]} ${c}`);
          return parts.length ? `1 AUD = ${parts.join('，')}` : null;
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
    const stats = await this.weeklySignals();
    if (stats.rent != null)
      lines.push(
        zh
          ? `🏠 租金观察：近 7 天租房帖中位要价 $${stats.rent}/周${stats.rentDelta != null ? `，环比 ${stats.rentDelta > 0 ? '+' : ''}${stats.rentDelta}%` : ''}（${stats.rentCount} 条样本）`
          : `🏠 Median asking rent $${stats.rent}/wk`,
      );
    if (stats.pay != null)
      lines.push(
        zh
          ? `💼 薪酬参考：近 7 天招工帖时薪中位数 $${stats.pay}/小时（${stats.payCount} 条样本）`
          : `💼 Median hourly pay $${stats.pay}/hr`,
      );
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
