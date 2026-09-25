import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthGuard, StaffMfaGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessTokenPayload } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ZodPipe } from '../../common/zod.pipe';
import { cursorQuerySchema, decodeCursor, toPage } from '../../common/pagination';
const reviewSchema = z.object({
  status: z.enum(['triaged', 'dismissed', 'actioned']),
  reason: z.string().trim().min(5).max(2000),
  updatedAt: z.string().datetime(),
});
const reportQuery = cursorQuerySchema.extend({
  status: z.enum(['open', 'triaged', 'actioned', 'dismissed']).optional(),
});
const listingQueueQuery = cursorQuerySchema.extend({
  status: z.enum(['pending_review', 'rejected']).default('pending_review'),
});
const listingReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(5).max(2000).optional(),
});
const appealQuery = cursorQuerySchema.extend({
  status: z.enum(['open', 'upheld', 'overturned']).default('open'),
});
const appealDecisionSchema = z.object({
  decision: z.enum(['upheld', 'overturned']),
  note: z.string().trim().min(5).max(2000),
});
const claimQuery = cursorQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
const claimDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(2000).optional(),
});
const articleSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120),
  title: z.string().trim().min(4).max(160),
  summary: z.string().trim().min(10).max(500),
  body: z.string().trim().min(10).max(50000),
  category: z.string().trim().min(1).max(60),
  locale: z.enum(['zh', 'en']),
  source: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v))
    .nullable(),
  collection: z.string().trim().max(80).nullable().optional(), // 专题 slug
  publishAt: z.string().datetime().nullable().optional(), // scheduled publish
  status: z.enum(['draft', 'published', 'hidden']),
});
const articleUpdate = articleSchema.extend({ updatedAt: z.string().datetime() });
const postModSchema = z.object({
  action: z.enum(['pin', 'unpin', 'lock', 'unlock', 'slowmode', 'move', 'merge']),
  boardSlug: z.string().trim().min(1).max(60).optional(),
  targetPostId: z.string().uuid().optional(),
  slowmodeSec: z.number().int().min(0).max(86400).optional(),
  reason: z.string().trim().max(500).optional(),
});
const muteSchema = z.object({
  days: z.number().int().min(1).max(365),
  reason: z.string().trim().min(5).max(500),
});
const configSchema = z.object({ value: z.unknown() });
function requireRole(user: AccessTokenPayload, roles: string[]) {
  if (!roles.includes(user.role)) throw new ForbiddenException('Insufficient permissions');
}
export const REVIEW_ROLES = ['moderator', 'admin', 'super_admin'];
export const EDIT_ROLES = ['editor', 'admin', 'super_admin'];
@Controller({ path: 'admin', version: '1' })
@UseGuards(AuthGuard, StaffMfaGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  /** Traffic & growth snapshot for the admin dashboard. */
  @Get('stats')
  async stats(@CurrentUser() user: AccessTokenPayload) {
    requireRole(user, ['admin', 'super_admin', 'moderator']);
    const now = Date.now();
    const dayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const d7 = new Date(now - 7 * 86400000);
    const d30 = new Date(now - 30 * 86400000);
    const activeSince = new Date(now - 15 * 60000);
    const [
      pvToday,
      pv7d,
      pv30d,
      uvToday,
      uv7d,
      usersTotal,
      usersToday,
      users7d,
      users30d,
      activeSessions,
      topPaths,
      latestUsers,
    ] = await Promise.all([
      this.prisma.pageView.count({ where: { createdAt: { gte: dayStart } } }),
      this.prisma.pageView.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.pageView.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.pageView.groupBy({
        by: ['visitorKey'],
        where: { createdAt: { gte: dayStart } },
      }),
      this.prisma.pageView.groupBy({ by: ['visitorKey'], where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { createdAt: { gte: dayStart } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.session.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() }, lastSeenAt: { gte: activeSince } },
      }),
      this.prisma.pageView.groupBy({
        by: ['path'],
        where: { createdAt: { gte: d7 } },
        _count: { path: true },
        orderBy: { _count: { path: 'desc' } },
        take: 10,
      }),
      this.prisma.user.findMany({
        where: { status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, displayName: true, role: true, createdAt: true, lastLoginAt: true },
      }),
    ]);
    return {
      pageviews: {
        today: pvToday,
        d7: pv7d,
        d30: pv30d,
        visitorsToday: uvToday.length,
        visitors7d: uv7d.length,
      },
      users: { total: usersTotal, today: usersToday, d7: users7d, d30: users30d },
      activeSessions,
      topPaths: topPaths.map((t) => ({ path: t.path, count: t._count.path })),
      latestUsers: latestUsers.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
    };
  }

  @Get('reports')
  async reports(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(reportQuery)) query: z.infer<typeof reportQuery>,
  ) {
    requireRole(user, REVIEW_ROLES);
    const c = decodeCursor(query.cursor);
    return toPage(
      await this.prisma.report.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(c
            ? {
                OR: [
                  { createdAt: { lt: c.createdAt } },
                  { createdAt: c.createdAt, id: { lt: c.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  @Get('reports/:id/subject')
  async subject(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    requireRole(user, REVIEW_ROLES);
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException();
    const where = { id: report.subjectId };
    const row =
      report.subjectType === 'listing'
        ? await this.prisma.listing.findUnique({
            where,
            select: { id: true, title: true, body: true, status: true },
          })
        : report.subjectType === 'post'
          ? await this.prisma.post.findUnique({
              where,
              select: { id: true, title: true, body: true, status: true },
            })
          : report.subjectType === 'comment'
            ? await this.prisma.comment.findUnique({
                where,
                select: { id: true, body: true, status: true },
              })
            : report.subjectType === 'article'
              ? await this.prisma.article.findUnique({
                  where,
                  select: { id: true, title: true, body: true, status: true },
                })
              : report.subjectType === 'business'
                ? await this.prisma.business.findUnique({
                    where,
                    select: { id: true, nameZh: true, descriptionZh: true, status: true },
                  })
                : report.subjectType === 'event'
                  ? await this.prisma.event.findUnique({
                      where,
                      select: { id: true, title: true, body: true, status: true },
                    })
                  : await this.prisma.user.findUnique({
                      where,
                      select: { id: true, displayName: true, bio: true, status: true },
                    });
    if (!row) throw new NotFoundException();
    return row;
  }

  @Patch('reports/:id')
  async review(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewSchema)) input: z.infer<typeof reviewSchema>,
  ) {
    requireRole(user, REVIEW_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({ where: { id } });
      if (!report) throw new NotFoundException();
      if (report.status === 'actioned' || report.status === 'dismissed')
        throw new ConflictException('Report already resolved');
      const changed = await tx.report.updateMany({
        where: { id, updatedAt: new Date(input.updatedAt), status: report.status },
        data: {
          status: input.status,
          ...(input.status === 'actioned' ? { actionedById: user.sub } : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictException('Report changed; reload');
      const where = { id: report.subjectId };
      if (input.status === 'actioned') {
        if (report.subjectType === 'listing')
          await tx.listing.update({
            where,
            data: { status: 'removed', version: { increment: 1 } },
          });
        else if (report.subjectType === 'post')
          await tx.post.update({ where, data: { status: 'removed' } });
        else if (report.subjectType === 'article')
          await tx.article.update({ where, data: { status: 'removed' } });
        else if (report.subjectType === 'business')
          await tx.business.update({ where, data: { status: 'removed' } });
        else if (report.subjectType === 'event')
          await tx.event.update({ where, data: { status: 'removed' } });
        else if (report.subjectType === 'comment') {
          const comment = await tx.comment.findUnique({ where });
          if (!comment) throw new NotFoundException();
          const removed = await tx.comment.updateMany({
            where: { ...where, status: 'published' },
            data: { status: 'removed' },
          });
          if (removed.count)
            await tx.post.update({
              where: { id: comment.postId },
              data: { commentCount: { decrement: 1 } },
            });
        } else if (report.subjectType === 'user') {
          const target = await tx.user.findUnique({ where });
          if (
            !target ||
            !['member', 'verified_member', 'merchant_staff'].includes(target.role) ||
            target.id === user.sub
          )
            throw new ForbiddenException('Cannot suspend this account');
          await tx.user.update({ where, data: { status: 'banned' } });
          await tx.session.updateMany({
            where: { userId: target.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        } else throw new UnprocessableEntityException('Unsupported subject');
      }
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          action: `report.${input.status}`,
          subject: `${report.subjectType}:${report.subjectId}`,
          reason: input.reason,
          metadata: { reportId: id, previousStatus: report.status },
        },
      });
      if (report.reporterId)
        await tx.notification.create({
          data: { userId: report.reporterId, kind: `report.${input.status}`, subjectId: id },
        });
      // §5.11: the affected party is told the public reason and gets an appeal path.
      if (input.status === 'actioned') {
        const ownerId = await this.subjectOwner(tx, report.subjectType, report.subjectId);
        if (ownerId)
          await tx.notification.create({
            data: { userId: ownerId, kind: 'moderation.actioned', subjectId: report.subjectId },
          });
      }
      return { id, status: input.status };
    });
  }

  private async subjectOwner(
    tx: Prisma.TransactionClient,
    subjectType: string,
    subjectId: string,
  ): Promise<string | null> {
    if (subjectType === 'listing')
      return (
        (await tx.listing.findUnique({ where: { id: subjectId }, select: { ownerId: true } }))
          ?.ownerId ?? null
      );
    if (subjectType === 'post')
      return (
        (await tx.post.findUnique({ where: { id: subjectId }, select: { authorId: true } }))
          ?.authorId ?? null
      );
    if (subjectType === 'comment')
      return (
        (await tx.comment.findUnique({ where: { id: subjectId }, select: { authorId: true } }))
          ?.authorId ?? null
      );
    if (subjectType === 'article')
      return (
        (await tx.article.findUnique({ where: { id: subjectId }, select: { authorId: true } }))
          ?.authorId ?? null
      );
    if (subjectType === 'business')
      return (
        (await tx.business.findUnique({ where: { id: subjectId }, select: { claimedById: true } }))
          ?.claimedById ?? null
      );
    if (subjectType === 'event')
      return (
        (await tx.event.findUnique({ where: { id: subjectId }, select: { organizerId: true } }))
          ?.organizerId ?? null
      );
    if (subjectType === 'user') return subjectId;
    return null;
  }

  // ---------- Listing review queue (§5.5 / §5.12) ----------

  @Get('listings')
  async listingQueue(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(listingQueueQuery)) query: z.infer<typeof listingQueueQuery>,
  ) {
    requireRole(user, REVIEW_ROLES);
    const c = decodeCursor(query.cursor);
    return toPage(
      await this.prisma.listing.findMany({
        where: {
          status: query.status,
          ...(c
            ? {
                OR: [
                  { createdAt: { lt: c.createdAt } },
                  { createdAt: c.createdAt, id: { lt: c.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: {
          owner: { select: { id: true, displayName: true, role: true } },
          city: { select: { slug: true, nameZh: true, nameEn: true } },
          _count: { select: { media: true } },
        },
      }),
      query.limit,
    );
  }

  @Post('listings/:id/review')
  async reviewListing(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(listingReviewSchema)) input: z.infer<typeof listingReviewSchema>,
  ) {
    requireRole(user, REVIEW_ROLES);
    if (input.decision === 'reject' && !input.reason)
      throw new UnprocessableEntityException('A reason is required when rejecting');
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({ where: { id } });
      if (!listing) throw new NotFoundException();
      if (listing.status !== 'pending_review')
        throw new ConflictException('Listing is not awaiting review');
      const approved = input.decision === 'approve';
      await tx.listing.update({
        where: { id, version: listing.version },
        data: {
          status: approved ? 'active' : 'rejected',
          reviewedById: user.sub,
          reviewNote: input.reason ?? null,
          version: { increment: 1 },
          ...(approved && !listing.publishedAt ? { publishedAt: new Date() } : {}),
        },
      });
      await tx.notification.create({
        data: {
          userId: listing.ownerId,
          kind: approved ? 'listing.approved' : 'listing.rejected',
          subjectId: id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          action: `listing.${input.decision}`,
          subject: `listing:${id}`,
          reason: input.reason,
        },
      });
      return { id, status: approved ? 'active' : 'rejected' };
    });
  }

  // ---------- Appeals (§5.11 step 6) ----------

  @Get('appeals')
  async appeals(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(appealQuery)) query: z.infer<typeof appealQuery>,
  ) {
    requireRole(user, REVIEW_ROLES);
    const c = decodeCursor(query.cursor);
    return toPage(
      await this.prisma.appeal.findMany({
        where: {
          status: query.status,
          ...(c
            ? {
                OR: [
                  { createdAt: { lt: c.createdAt } },
                  { createdAt: c.createdAt, id: { lt: c.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: {
          appellant: { select: { id: true, displayName: true } },
          report: { select: { id: true, reference: true, actionedById: true } },
        },
      }),
      query.limit,
    );
  }

  @Patch('appeals/:id')
  async decideAppeal(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(appealDecisionSchema)) input: z.infer<typeof appealDecisionSchema>,
  ) {
    requireRole(user, REVIEW_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const appeal = await tx.appeal.findUnique({
        where: { id },
        include: { report: { select: { actionedById: true } } },
      });
      if (!appeal) throw new NotFoundException();
      if (appeal.status !== 'open') throw new ConflictException('Appeal already decided');
      // The original handler cannot be the sole decider of their own action.
      const original = appeal.report?.actionedById ?? (await this.originalReviewer(tx, appeal));
      if (original === user.sub)
        throw new ForbiddenException('The original moderator cannot decide this appeal');
      const updated = await tx.appeal.updateMany({
        where: { id, status: 'open' },
        data: {
          status: input.decision,
          decidedById: user.sub,
          decisionNote: input.note,
          decidedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new ConflictException('Appeal already decided');
      if (input.decision === 'overturned')
        await this.restoreSubject(tx, appeal.subjectType, appeal.subjectId);
      await tx.notification.create({
        data: {
          userId: appeal.appellantId,
          kind: `appeal.${input.decision}`,
          subjectId: appeal.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          action: `appeal.${input.decision}`,
          subject: `${appeal.subjectType}:${appeal.subjectId}`,
          reason: input.note,
          metadata: { appealId: id },
        },
      });
      return { id, status: input.decision };
    });
  }

  private async originalReviewer(
    tx: Prisma.TransactionClient,
    appeal: { subjectType: string; subjectId: string },
  ): Promise<string | null> {
    if (appeal.subjectType === 'listing')
      return (
        (
          await tx.listing.findUnique({
            where: { id: appeal.subjectId },
            select: { reviewedById: true },
          })
        )?.reviewedById ?? null
      );
    return null;
  }

  private async restoreSubject(tx: Prisma.TransactionClient, type: string, id: string) {
    if (type === 'listing') {
      const row = await tx.listing.findUnique({ where: { id } });
      if (!row || (row.status !== 'removed' && row.status !== 'rejected')) return;
      const status = row.expiresAt > new Date() ? 'active' : 'expired';
      await tx.listing.update({
        where: { id },
        data: { status, version: { increment: 1 }, publishedAt: row.publishedAt ?? new Date() },
      });
    } else if (type === 'post') {
      await tx.post.updateMany({
        where: { id, status: { in: ['removed', 'hidden'] } },
        data: { status: 'published' },
      });
    } else if (type === 'comment') {
      const comment = await tx.comment.findUnique({ where: { id } });
      if (comment && ['removed', 'hidden'].includes(comment.status)) {
        await tx.comment.update({ where: { id }, data: { status: 'published' } });
        await tx.post.update({
          where: { id: comment.postId },
          data: { commentCount: { increment: 1 } },
        });
      }
    } else if (type === 'article') {
      await tx.article.updateMany({
        where: { id, status: { in: ['removed', 'hidden'] } },
        data: { status: 'published' },
      });
    } else if (type === 'business') {
      await tx.business.updateMany({
        where: { id, status: { in: ['removed', 'hidden'] } },
        data: { status: 'active' },
      });
    } else if (type === 'event') {
      await tx.event.updateMany({
        where: { id, status: { in: ['removed', 'cancelled'] } },
        data: { status: 'published' },
      });
    }
  }

  // ---------- Business claims ----------

  @Get('business-claims')
  async businessClaims(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(claimQuery)) query: z.infer<typeof claimQuery>,
  ) {
    requireRole(user, REVIEW_ROLES);
    const c = decodeCursor(query.cursor);
    return toPage(
      await this.prisma.businessClaim.findMany({
        where: {
          status: query.status,
          ...(c
            ? {
                OR: [
                  { createdAt: { lt: c.createdAt } },
                  { createdAt: c.createdAt, id: { lt: c.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: {
          business: { select: { id: true, nameZh: true, nameEn: true, claimedById: true } },
          claimant: { select: { id: true, displayName: true } },
        },
      }),
      query.limit,
    );
  }

  @Patch('business-claims/:id')
  async decideClaim(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(claimDecisionSchema)) input: z.infer<typeof claimDecisionSchema>,
  ) {
    requireRole(user, REVIEW_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.businessClaim.findUnique({ where: { id } });
      if (!claim) throw new NotFoundException();
      if (claim.status !== 'pending') throw new ConflictException('Claim already decided');
      const updated = await tx.businessClaim.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: input.decision,
          decidedById: user.sub,
          decisionNote: input.note ?? null,
          decidedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new ConflictException('Claim already decided');
      if (input.decision === 'approved') {
        await tx.business.update({
          where: { id: claim.businessId },
          data: { claimedById: claim.claimantId, claimedAt: new Date() },
        });
        // No second claimant can queue behind an approved claim.
        await tx.businessClaim.updateMany({
          where: { businessId: claim.businessId, status: 'pending' },
          data: {
            status: 'rejected',
            decidedById: user.sub,
            decisionNote: 'Business already claimed',
            decidedAt: new Date(),
          },
        });
      }
      await tx.notification.create({
        data: {
          userId: claim.claimantId,
          kind: `claim.${input.decision}`,
          subjectId: claim.businessId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          action: `business.claim.${input.decision}`,
          subject: `business:${claim.businessId}`,
          reason: input.note,
          metadata: { claimId: id },
        },
      });
      return { id, status: input.decision };
    });
  }

  @Get('articles')
  async articles(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(cursorQuerySchema)) query: z.infer<typeof cursorQuerySchema>,
  ) {
    requireRole(user, EDIT_ROLES);
    const c = decodeCursor(query.cursor);
    return toPage(
      await this.prisma.article.findMany({
        where: c
          ? {
              OR: [
                { createdAt: { lt: c.createdAt } },
                { createdAt: c.createdAt, id: { lt: c.id } },
              ],
            }
          : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  /** §5.3 双人审批：enabled via app_config.cms.dualApproval. */
  private async dualApprovalRequired(): Promise<boolean> {
    const cfg = await this.prisma.appConfig.findUnique({ where: { key: 'cms' } });
    const value = cfg?.value;
    return (
      !!value &&
      typeof value === 'object' &&
      (value as { dualApproval?: boolean }).dualApproval === true
    );
  }

  /** A second editor signs off before publish; authors cannot approve their own work. */
  @Post('articles/:id/approve')
  async approveArticle(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    requireRole(user, EDIT_ROLES);
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) throw new NotFoundException();
    if (article.authorId === user.sub)
      throw new ForbiddenException('Authors cannot approve their own article');
    const updated = await this.prisma.article.update({
      where: { id },
      data: { approvedById: user.sub, approvedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'article.approve', subject: `article:${id}` },
    });
    return updated;
  }

  @Post('articles')
  async createArticle(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(articleSchema)) input: z.infer<typeof articleSchema>,
  ) {
    requireRole(user, EDIT_ROLES);
    if (input.status === 'published' && (await this.dualApprovalRequired()))
      throw new ForbiddenException('Second-editor approval required before publishing');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const article = await tx.article.create({
          data: {
            ...input,
            publishAt: input.publishAt ? new Date(input.publishAt) : null,
            authorId: user.sub,
            publishedAt: input.status === 'published' ? new Date() : null,
          },
        });
        await tx.auditLog.create({
          data: { actorId: user.sub, action: 'article.create', subject: `article:${article.id}` },
        });
        return article;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Slug already exists');
      throw error;
    }
  }

  @Patch('articles/:id')
  async updateArticle(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(articleUpdate)) input: z.infer<typeof articleUpdate>,
  ) {
    requireRole(user, EDIT_ROLES);
    const { updatedAt, ...data } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const old = await tx.article.findUnique({ where: { id } });
        if (!old) throw new NotFoundException();
        if (old.status === 'removed')
          throw new ForbiddenException('Removed content cannot be republished');
        // §5.3 双人审批：edits reset the sign-off, and publishing needs a
        // different editor's approval when the policy is enabled.
        if (data.status === 'published' && old.status !== 'published') {
          if (
            (await this.dualApprovalRequired()) &&
            (!old.approvedById || old.approvedById === user.sub)
          )
            throw new ForbiddenException('Second-editor approval required before publishing');
        }
        // §5.3 修订：keep the previous version for the audit trail.
        await tx.contentRevision.create({
          data: {
            subjectType: 'article',
            subjectId: id,
            editorId: user.sub,
            title: old.title,
            body: old.body,
          },
        });
        const updated = await tx.article.update({
          where: { id, updatedAt: new Date(updatedAt) },
          data: {
            ...data,
            publishAt: data.publishAt ? new Date(data.publishAt) : null,
            publishedAt:
              data.status === 'published' ? (old.publishedAt ?? new Date()) : old.publishedAt,
            approvedById: null,
            approvedAt: null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            action: 'article.update',
            subject: `article:${id}`,
            metadata: {
              previous: {
                title: old.title,
                body: old.body,
                status: old.status,
                summary: old.summary,
                slug: old.slug,
                locale: old.locale,
                category: old.category,
                source: old.source,
              },
            },
          },
        });
        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2025'].includes(error.code)
      )
        throw new ConflictException('Article changed or slug already exists');
      throw error;
    }
  }

  /** Article revision history (§5.3 修订可审计). */
  @Get('articles/:id/revisions')
  async articleRevisions(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    requireRole(user, EDIT_ROLES);
    return {
      items: await this.prisma.contentRevision.findMany({
        where: { subjectType: 'article', subjectId: id },
        orderBy: { createdAt: 'desc' },
      }),
    };
  }

  // ---------- Moderator tools for posts (§5.4 版主管理) ----------

  @Post('posts/:id/mod')
  async modPost(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(postModSchema)) input: z.infer<typeof postModSchema>,
  ) {
    requireRole(user, REVIEW_ROLES);
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException();
    const data: Prisma.PostUpdateInput = {};
    if (input.action === 'pin') data.pinned = true;
    else if (input.action === 'unpin') data.pinned = false;
    else if (input.action === 'lock') data.locked = true;
    else if (input.action === 'unlock') data.locked = false;
    else if (input.action === 'slowmode') data.slowmodeSec = input.slowmodeSec ?? 0;
    else if (input.action === 'move') {
      if (!input.boardSlug) throw new UnprocessableEntityException('boardSlug required');
      const board = await this.prisma.board.findUnique({ where: { slug: input.boardSlug } });
      if (!board) throw new NotFoundException('Board not found');
      data.board = { connect: { id: board.id } };
    } else if (input.action === 'merge') {
      // Move comments onto the target post, then remove the merged shell.
      if (!input.targetPostId || input.targetPostId === id)
        throw new UnprocessableEntityException('targetPostId required');
      const target = await this.prisma.post.findUnique({ where: { id: input.targetPostId } });
      if (!target || target.status !== 'published') throw new NotFoundException('Target not found');
      await this.prisma.$transaction(async (tx) => {
        await tx.comment.updateMany({ where: { postId: id }, data: { postId: target.id } });
        await tx.post.update({
          where: { id: target.id },
          data: { commentCount: { increment: post.commentCount }, lastActiveAt: new Date() },
        });
        await tx.post.update({ where: { id }, data: { status: 'removed', commentCount: 0 } });
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            action: 'post.merge',
            subject: `post:${id}`,
            reason: input.reason,
            metadata: { into: target.id },
          },
        });
      });
      return { ok: true, mergedInto: target.id };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.post.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          action: `post.${input.action}`,
          subject: `post:${id}`,
          reason: input.reason,
        },
      });
    });
    return { ok: true };
  }

  // ---------- User moderation ----------

  @Post('users/:id/mute')
  async mute(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(muteSchema)) input: z.infer<typeof muteSchema>,
  ) {
    requireRole(user, REVIEW_ROLES);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException();
    if (REVIEW_ROLES.includes(target.role) || EDIT_ROLES.includes(target.role))
      throw new ForbiddenException('Cannot mute staff');
    const mutedUntil = new Date(Date.now() + input.days * 86_400_000);
    await this.prisma.user.update({ where: { id }, data: { mutedUntil } });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action: 'user.mute',
        subject: `user:${id}`,
        reason: input.reason,
        metadata: { days: input.days },
      },
    });
    return { mutedUntil };
  }

  @Post('users/:id/unmute')
  async unmute(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    requireRole(user, REVIEW_ROLES);
    await this.prisma.user.update({ where: { id }, data: { mutedUntil: null } });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'user.unmute', subject: `user:${id}` },
    });
    return { ok: true };
  }

  // ---------- Dashboard & config (§5.12) ----------

  @Get('dashboard')
  async dashboard(@CurrentUser() user: AccessTokenPayload) {
    requireRole(user, [...REVIEW_ROLES, ...EDIT_ROLES]);
    const day = new Date(Date.now() - 86_400_000);
    const [
      users,
      newUsers,
      listingsActive,
      listingsPending,
      reportsOpen,
      appealsOpen,
      claimsPending,
      revenue,
      activeAds,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { createdAt: { gt: day } } }),
      this.prisma.listing.count({ where: { status: 'active' } }),
      this.prisma.listing.count({ where: { status: 'pending_review' } }),
      this.prisma.report.count({ where: { status: 'open' } }),
      this.prisma.appeal.count({ where: { status: 'open' } }),
      this.prisma.businessClaim.count({ where: { status: 'pending' } }),
      this.prisma.payment.aggregate({
        where: { status: 'paid' },
        _sum: { amountMinor: true },
      }),
      this.prisma.adCampaign.count({ where: { status: 'active' } }),
    ]);
    return {
      users,
      newUsers24h: newUsers,
      listingsActive,
      listingsPending,
      reportsOpen,
      appealsOpen,
      claimsPending,
      revenueMinor: revenue._sum.amountMinor ?? 0,
      activeAds,
    };
  }

  @Get('config')
  async config(@CurrentUser() user: AccessTokenPayload) {
    requireRole(user, ['admin', 'super_admin']);
    const rows = await this.prisma.appConfig.findMany({ orderBy: { key: 'asc' } });
    return { items: rows };
  }

  @Patch('config/:key')
  async setConfig(
    @CurrentUser() user: AccessTokenPayload,
    @Param('key') key: string,
    @Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>,
  ) {
    requireRole(user, ['admin', 'super_admin']);
    const row = await this.prisma.appConfig.upsert({
      where: { key },
      update: { value: body.value as Prisma.InputJsonValue },
      create: { key, value: body.value as Prisma.InputJsonValue },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action: 'config.update',
        subject: `config:${key}`,
        metadata: { value: body.value as Prisma.InputJsonValue },
      },
    });
    return row;
  }

  /** Ad campaign approval: review the creative before it can go live. */
  @Get('ads')
  async adCampaigns(@CurrentUser() user: AccessTokenPayload) {
    requireRole(user, REVIEW_ROLES);
    return {
      items: await this.prisma.adCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { owner: { select: { id: true, displayName: true } } },
      }),
    };
  }

  @Patch('ads/:id')
  async reviewAd(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ status: z.enum(['active', 'paused', 'ended']) })))
    body: { status: string },
  ) {
    requireRole(user, REVIEW_ROLES);
    const campaign = await this.prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException();
    const updated = await this.prisma.adCampaign.update({
      where: { id },
      data: { status: body.status },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action: `ad.${body.status}`,
        subject: `ad:${id}`,
      },
    });
    return updated;
  }
}
