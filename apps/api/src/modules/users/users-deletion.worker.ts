import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Anonymizes accounts whose deletion grace period has elapsed (§5.1 注销冷静期).
 * Conditional updates make concurrent API instances safe.
 */
@Injectable()
export class UsersDeletionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsersDeletionWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const graceDays = Number(process.env.DELETION_GRACE_DAYS ?? 7);
      const cutoff = new Date(now.getTime() - graceDays * 86_400_000);
      const due = await this.prisma.user.findMany({
        where: { deletionRequestedAt: { lte: cutoff }, status: { not: 'deleted' } },
        select: { id: true },
      });
      for (const { id } of due) await this.anonymize(id);
      return due.length;
    } catch (error) {
      this.logger.error('Account deletion sweep failed; retrying on next interval', error);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async anonymize(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id: userId, status: { not: 'deleted' } },
        data: {
          status: 'deleted',
          displayName: 'Deleted user',
          bio: null,
          interests: [],
          homeCityId: null,
          avatarMediaId: null,
          deletionRequestedAt: null,
        },
      });
      if (claimed.count !== 1) return;
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.identity.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { action: 'user.deletion.completed', subject: `user:${userId}` },
      });
    });
  }
}
