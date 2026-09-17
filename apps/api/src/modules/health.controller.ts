import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<{ status: string; db: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'ok' };
  }

  /** Minimal operational metrics for dashboards/alerts (N-19). */
  @Get('metrics')
  async metrics(): Promise<Record<string, number | string>> {
    const [users, listings, pendingReview, openReports, undeliveredOutbox] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.listing.count({ where: { status: 'active' } }),
      this.prisma.listing.count({ where: { status: 'pending_review' } }),
      this.prisma.report.count({ where: { status: 'open' } }),
      this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
    ]);
    const memory = process.memoryUsage();
    return {
      uptimeSec: Math.round(process.uptime()),
      users,
      listings,
      pendingReview,
      openReports,
      undeliveredOutbox,
      heapUsedMb: Math.round(memory.heapUsed / 1048576),
      rssMb: Math.round(memory.rss / 1048576),
    };
  }
}
