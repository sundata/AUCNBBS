import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { notify } from '../../common/notify';
import { PrismaService } from '../prisma/prisma.service';

const INTERVAL_MS = 3_600_000; // hourly

const CADENCE_MS: Record<string, number> = {
  instant: INTERVAL_MS,
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
};

/**
 * Background notification pipeline:
 *  - saved-search alerts (§5.8 新结果提醒, instant≈hourly/daily/weekly)
 *  - event reminders 24h before start + recurring-event fan-out (§5.7)
 *  - scheduled article publishing (§5.3 定时发布)
 *  - outbox dispatch marking (§12.3)
 */
@Injectable()
export class NotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishScheduledArticles(now);
      await this.dispatchOutbox(now);
      await this.eventReminders(now);
      await this.spinRecurringEvents(now);
      await this.savedSearchAlerts(now);
    } catch (error) {
      this.logger.error('Notification tick failed; retrying next interval', error);
    } finally {
      this.running = false;
    }
  }

  /** Articles whose scheduled publish time has arrived. */
  private async publishScheduledArticles(now: Date): Promise<number> {
    const due = await this.prisma.article.updateMany({
      where: { status: 'draft', publishAt: { lte: now } },
      data: { status: 'published', publishedAt: now, publishAt: null },
    });
    return due.count;
  }

  /** Mark outbox rows as dispatched (single-process deployment: dispatch = recorded). */
  private async dispatchOutbox(now: Date): Promise<number> {
    const res = await this.prisma.outboxEvent.updateMany({
      where: { publishedAt: null },
      data: { publishedAt: now },
    });
    return res.count;
  }

  /** Notify 'going' RSVPs 24h before the event starts (once per event). */
  private async eventReminders(now: Date): Promise<number> {
    const due = await this.prisma.event.findMany({
      where: {
        status: 'published',
        reminderSentAt: null,
        startsAt: { gt: now, lte: new Date(now.getTime() + 86_400_000) },
      },
      include: { rsvps: { where: { status: 'going' }, select: { userId: true } } },
    });
    let sent = 0;
    for (const event of due) {
      for (const rsvp of event.rsvps) {
        await notify(this.prisma, rsvp.userId, 'event.reminder', event.id, {
          title: event.title,
          startsAt: event.startsAt.toISOString(),
        });
        sent++;
      }
      await this.prisma.event.update({
        where: { id: event.id },
        data: { reminderSentAt: now },
      });
    }
    return sent;
  }

  /** When a recurring event ends, create the next occurrence and carry RSVPs over. */
  private async spinRecurringEvents(now: Date): Promise<number> {
    const ended = await this.prisma.event.findMany({
      where: {
        status: 'published',
        recurrence: { not: null },
        endsAt: { lt: now },
        // No next occurrence yet for the same title+organizer.
      },
      take: 20,
    });
    const STEP: Record<string, number> = {
      weekly: 7 * 86_400_000,
      fortnightly: 14 * 86_400_000,
      monthly: 30 * 86_400_000,
    };
    let created = 0;
    for (const event of ended) {
      const step = STEP[event.recurrence!];
      if (!step) continue;
      const nextStart = new Date(event.startsAt.getTime() + step);
      const nextEnd = new Date(event.endsAt.getTime() + step);
      const already = await this.prisma.event.findFirst({
        where: {
          organizerId: event.organizerId,
          title: event.title,
          startsAt: nextStart,
          status: { not: 'removed' },
        },
      });
      if (already) continue;
      await this.prisma.event.create({
        data: {
          organizerId: event.organizerId,
          title: event.title,
          body: event.body,
          category: event.category,
          cityId: event.cityId,
          venue: event.venue,
          online: event.online,
          startsAt: nextStart,
          endsAt: nextEnd,
          capacity: event.capacity,
          priceMinor: event.priceMinor,
          externalUrl: event.externalUrl,
          recurrence: event.recurrence,
        },
      });
      created++;
    }
    return created;
  }

  /** Scan saved searches and notify owners of new matching content (§5.8). */
  private async savedSearchAlerts(now: Date): Promise<number> {
    const searches = await this.prisma.savedSearch.findMany({
      where: { cadence: { not: 'off' } },
      take: 500,
    });
    let alerted = 0;
    for (const s of searches) {
      const interval = CADENCE_MS[s.cadence] ?? CADENCE_MS.daily;
      const since = s.lastNotifiedAt ?? s.createdAt;
      if (now.getTime() - since.getTime() < interval) continue;
      const filters = (s.filters ?? {}) as { type?: string; cityId?: string };
      const matches = await this.prisma.listing.findMany({
        where: {
          status: 'active',
          expiresAt: { gt: now },
          publishedAt: { gt: since },
          ...(filters.type ? { type: filters.type as never } : {}),
          ...(filters.cityId ? { cityId: filters.cityId } : {}),
          OR: [
            { title: { contains: s.query, mode: 'insensitive' } },
            { body: { contains: s.query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, title: true },
        take: 5,
      });
      // Claim the window first so concurrent workers don't double-notify.
      const claimed = await this.prisma.savedSearch.updateMany({
        where: { id: s.id, lastNotifiedAt: s.lastNotifiedAt },
        data: { lastNotifiedAt: now },
      });
      if (claimed.count !== 1) continue;
      if (matches.length > 0) {
        await notify(this.prisma, s.userId, 'saved_search.match', s.id, {
          name: s.name,
          count: matches.length,
          top: matches.map((m) => ({ id: m.id, title: m.title })),
        });
        alerted++;
      }
    }
    return alerted;
  }
}
