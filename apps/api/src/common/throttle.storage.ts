import type { ThrottlerStorage } from '@nestjs/throttler';
import type { PrismaService } from '../modules/prisma/prisma.service';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Postgres-backed throttler storage (W-9): rate limits are shared across
 * API instances instead of living in per-process memory. Hit timestamps are
 * stored as a JSON array pruned to the active window; expired buckets are
 * swept opportunistically.
 */
export class PrismaThrottleStorage implements ThrottlerStorage {
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    const windowStart = now - ttl;
    const existing = await this.prisma.throttleBucket.findUnique({ where: { key } });
    const prev =
      existing && existing.expiresAt.getTime() > now && Array.isArray(existing.hits)
        ? (existing.hits as number[]).filter((t) => t > windowStart)
        : [];
    const hits = [...prev, now];
    const blocked = hits.length > limit;
    const expiresAt = new Date(now + ttl + (blocked ? blockDuration : 0));
    await this.prisma.throttleBucket.upsert({
      where: { key },
      update: { hits, expiresAt },
      create: { key, hits, expiresAt },
    });
    if (Math.random() < 0.01) {
      const stale = { expiresAt: { lt: new Date() } };
      await this.prisma.throttleBucket.deleteMany({ where: stale }).catch(() => undefined);
    }
    return {
      totalHits: hits.length,
      timeToExpire: Math.max(0, expiresAt.getTime() - now),
      isBlocked: blocked,
      timeToBlockExpire: blocked ? blockDuration : 0,
    };
  }
}
