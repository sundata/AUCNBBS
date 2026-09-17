import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createAppealSchema } from '@aucn/domain';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

function makeReference(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
  return `APL-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

@ApiTags('appeals')
@ApiBearerAuth()
@Controller({ path: 'appeals', version: '1' })
@UseGuards(AuthGuard)
export class AppealsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appeal a moderation outcome on content the caller owns.
   * Eligible subjects: listing (removed/rejected), post/comment (removed/hidden),
   * article (removed/hidden). Banned-account appeals need a logged-in session,
   * so account bans are handled through the support channel instead.
   */
  @Post()
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(createAppealSchema)) body: z.infer<typeof createAppealSchema>,
  ) {
    const ownerId = await this.moderatedOwner(body.subjectType, body.subjectId);
    if (!ownerId) throw new NotFoundException('Nothing to appeal');
    if (ownerId !== user.sub) throw new ForbiddenException('Only the author can appeal');
    const open = await this.prisma.appeal.findFirst({
      where: {
        appellantId: user.sub,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        status: 'open',
      },
      select: { id: true },
    });
    if (open) throw new ConflictException('An appeal is already open for this subject');
    const lastAction = await this.prisma.report.findFirst({
      where: { subjectType: body.subjectType, subjectId: body.subjectId, status: 'actioned' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const appeal = await this.prisma.appeal.create({
      data: {
        reference: makeReference(),
        appellantId: user.sub,
        reportId: lastAction?.id,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        reason: body.reason,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action: 'appeal.create',
        subject: `${body.subjectType}:${body.subjectId}`,
        metadata: { appealId: appeal.id },
      },
    });
    return appeal;
  }

  @Get('mine')
  async mine(@CurrentUser() user: AccessTokenPayload) {
    return {
      items: await this.prisma.appeal.findMany({
        where: { appellantId: user.sub },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          reference: true,
          subjectType: true,
          subjectId: true,
          reason: true,
          status: true,
          decisionNote: true,
          createdAt: true,
          decidedAt: true,
        },
      }),
    };
  }

  /** Returns the owner id when the subject exists AND is in a state worth appealing. */
  private async moderatedOwner(type: string, id: string): Promise<string | null> {
    if (type === 'listing') {
      const row = await this.prisma.listing.findFirst({
        where: { id, status: { in: ['removed', 'rejected'] } },
        select: { ownerId: true },
      });
      return row?.ownerId ?? null;
    }
    if (type === 'post') {
      const row = await this.prisma.post.findFirst({
        where: { id, status: { in: ['removed', 'hidden'] } },
        select: { authorId: true },
      });
      return row?.authorId ?? null;
    }
    if (type === 'comment') {
      const row = await this.prisma.comment.findFirst({
        where: { id, status: { in: ['removed', 'hidden'] } },
        select: { authorId: true },
      });
      return row?.authorId ?? null;
    }
    if (type === 'business') {
      const row = await this.prisma.business.findFirst({
        where: { id, status: { in: ['removed', 'hidden'] } },
        select: { claimedById: true, createdById: true },
      });
      return row ? (row.claimedById ?? row.createdById) : null;
    }
    if (type === 'event') {
      const row = await this.prisma.event.findFirst({
        where: { id, status: { in: ['removed', 'cancelled'] } },
        select: { organizerId: true },
      });
      return row?.organizerId ?? null;
    }
    const row = await this.prisma.article.findFirst({
      where: { id, status: { in: ['removed', 'hidden'] } },
      select: { authorId: true },
    });
    return row?.authorId ?? null;
  }
}
