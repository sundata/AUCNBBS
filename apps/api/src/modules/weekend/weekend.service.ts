import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { eventInput, fingerprint, parseFeed, sourceInput } from './weekend.helpers';
import { fetchFeed } from './feed-fetch';
import { extractCity, extractEventDate, extractLocation } from '../../common/extract';
import { screenText } from '../../common/risk';

@Injectable()
export class WeekendService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private readonly logger = new Logger(WeekendService.name);
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    if (process.env.WEEKEND_COLLECTOR_ENABLED !== 'true') return;
    try {
      const sources = z
        .array(sourceInput)
        .max(20)
        .parse(JSON.parse(process.env.WEEKEND_SOURCES_JSON ?? '[]'));
      const ids = sources.map((s) => s.id);
      await this.prisma.weekendSource.updateMany({
        where: { id: { notIn: ids } },
        data: { enabled: false },
      });
      for (const source of sources)
        await this.prisma.weekendSource.upsert({
          where: { id: source.id },
          create: source,
          update: source,
        });
      void this.tick();
      this.timer = setInterval(() => void this.tick(), 60_000);
      this.timer.unref();
    } catch {
      // Invalid configuration must not leave previously enabled sources running.
      this.logger.error(
        'Weekend collector disabled: invalid configuration or unavailable database',
      );
    }
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  async importRows(
    source: { id: string; cityId: string | null; category: string },
    rows: z.infer<typeof eventInput>[],
  ) {
    const cities = await this.prisma.city.findMany({
      select: { id: true, nameEn: true, timezone: true },
    });
    const data = [];
    for (const row of rows) {
      const signal = `${row.title} ${row.sourceName}`;
      const cityName = extractCity(signal);
      const city = cityName ? cities.find((c) => c.nameEn === cityName) : undefined;
      const date = extractEventDate(signal, new Date(), city?.timezone ?? 'Australia/Sydney');
      // Dated leads publish automatically when the risk screen is clean;
      // undated posts stay as pending editorial leads.
      const publishable =
        date != null && date.end > new Date() && !(await screenText(this.prisma, signal)).length;
      data.push({
        ...row,
        sourceId: source.id,
        cityId: row.cityId ?? source.cityId ?? city?.id ?? null,
        suburb: extractLocation(signal) ?? row.suburb,
        category: row.category === 'general' ? source.category : row.category,
        status: publishable ? 'published' : 'pending',
        fingerprint: fingerprint(row.sourceUrl, row.startsAt),
        // A feed is not an editorial introduction: require the reviewer to write it.
        summary: '',
        startsAt: date?.start ?? (row.startsAt ? new Date(row.startsAt) : null),
        endsAt: date?.end ?? (row.endsAt ? new Date(row.endsAt) : null),
      });
    }
    const result = await this.prisma.weekendEvent.createMany({ skipDuplicates: true, data });
    return result.count;
  }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const now = new Date();
      const sources = await this.prisma.weekendSource.findMany({
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
        const leaseUntil = new Date(Date.now() + 120000);
        const claimed = await this.prisma.weekendSource.updateMany({
          where: {
            id: source.id,
            enabled: true,
            nextRunAt: { lte: now },
            OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
          },
          data: { leaseUntil, lastRunAt: new Date() },
        });
        if (!claimed.count) continue;
        try {
          const rows = parseFeed(await fetchFeed(source.url), source.format, source.name);
          const count = await this.importRows(source, rows);
          await this.prisma.weekendSource.updateMany({
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
          await this.prisma.weekendSource.updateMany({
            where: { id: source.id, leaseUntil },
            data: {
              leaseUntil: null,
              lastError: error instanceof Error ? error.message.slice(0, 300) : 'Collection failed',
              failures: { increment: 1 },
              nextRunAt: new Date(
                Date.now() +
                  Math.min(
                    1440,
                    source.intervalMinutes * Math.pow(2, Math.min(source.failures, 5)),
                  ) *
                    60000,
              ),
            },
          });
        }
      }
    } catch {
      this.logger.error('Weekend collection failed; retrying next minute');
    } finally {
      this.running = false;
    }
  }
}
