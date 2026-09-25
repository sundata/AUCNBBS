import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from './prisma/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

const pageviewSchema = z.object({
  path: z.string().min(1).max(200),
  referrer: z.string().max(300).optional(),
});

/** Paths we don't record — admin/account noise and non-page hits. */
const SKIP_PREFIXES = ['/api', '/admin', '/me', '/auth', '/messages', '/_next', '/zh/admin', '/zh/me'];

/**
 * Anonymous traffic counters. visitorKey is a daily-rotating hash of
 * ip+ua+date so we can count unique visitors without storing raw IPs.
 */
@Controller({ path: 'metrics', version: '1' })
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('pageview')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async pageview(
    @Body(new ZodPipe(pageviewSchema)) body: z.infer<typeof pageviewSchema>,
    @Headers('user-agent') ua: string | undefined,
    @Ip() ip: string | undefined,
  ) {
    const path = body.path.split('?')[0].slice(0, 200);
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return { ok: true };
    const day = new Date().toISOString().slice(0, 10);
    const salt = process.env.METRICS_SALT ?? process.env.POSTGRES_PASSWORD ?? 'aucn';
    const visitorKey = createHash('sha256')
      .update(`${ip ?? ''}|${ua ?? ''}|${day}|${salt}`)
      .digest('hex')
      .slice(0, 32);
    await this.prisma.pageView.create({
      data: { path, referrer: body.referrer?.slice(0, 300) ?? null, visitorKey },
    });
    return { ok: true };
  }
}
