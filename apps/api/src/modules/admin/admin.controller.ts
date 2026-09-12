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
import { AuthGuard } from '../auth/auth.guard';
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
  status: z.enum(['draft', 'published', 'hidden']),
});
const articleUpdate = articleSchema.extend({ updatedAt: z.string().datetime() });
function requireRole(user: AccessTokenPayload, roles: string[]) {
  if (!roles.includes(user.role)) throw new ForbiddenException('Insufficient permissions');
}
export const REVIEW_ROLES = ['moderator', 'admin', 'super_admin'];
export const EDIT_ROLES = ['editor', 'admin', 'super_admin'];
@Controller({ path: 'admin', version: '1' })
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

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
        data: { status: input.status },
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
      return { id, status: input.status };
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

  @Post('articles')
  async createArticle(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(articleSchema)) input: z.infer<typeof articleSchema>,
  ) {
    requireRole(user, EDIT_ROLES);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const article = await tx.article.create({
          data: {
            ...input,
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
        const updated = await tx.article.update({
          where: { id, updatedAt: new Date(updatedAt) },
          data: {
            ...data,
            publishedAt:
              data.status === 'published' ? (old.publishedAt ?? new Date()) : old.publishedAt,
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
}
