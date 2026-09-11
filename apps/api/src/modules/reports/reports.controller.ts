import { Body, Controller, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createReportSchema, REPORT_SEVERITY, ReportSubjectType } from '@aucn/domain';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { OptionalAuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export interface ReportReceiptDto {
  reference: string;
  status: string;
  createdAt: string;
}

function makeReference(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `RPT-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

@ApiTags('reports')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async create(
    @Body(new ZodPipe(createReportSchema)) body: z.infer<typeof createReportSchema>,
    @CurrentUser() user?: AccessTokenPayload,
  ): Promise<ReportReceiptDto> {
    await this.assertSubjectExists(body.subjectType, body.subjectId);
    const report = await this.prisma.report.create({
      data: {
        reference: makeReference(),
        reporterId: user?.sub,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        reason: body.reason,
        details: body.details,
        severity: REPORT_SEVERITY[body.reason],
      },
    });
    return {
      reference: report.reference,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    };
  }

  private async assertSubjectExists(type: ReportSubjectType, id: string): Promise<void> {
    const exists =
      type === 'listing'
        ? await this.prisma.listing.findUnique({ where: { id }, select: { id: true } })
        : type === 'post'
          ? await this.prisma.post.findUnique({ where: { id }, select: { id: true } })
          : type === 'comment'
            ? await this.prisma.comment.findUnique({ where: { id }, select: { id: true } })
            : type === 'article'
              ? await this.prisma.article.findUnique({ where: { id }, select: { id: true } })
              : await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Report subject not found');
  }
}
