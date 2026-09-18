import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessTokenPayload } from '../auth/auth.service';
import { ZodPipe } from '../../common/zod.pipe';
import { eventInput, reviewInput, weekendRange, calendar } from './weekend.helpers';

const browse = z.object({
  period: z.enum(['weekend', 'upcoming']).default('weekend'),
  free: z.enum(['true', 'false']).optional(),
  family: z.enum(['true', 'false']).optional(),
  indoor: z.enum(['true', 'false']).optional(),
  suburb: z.string().trim().max(100).optional(),
  city: z.string().trim().max(60).optional(),
  category: z.enum(['general', 'family', 'social', 'market', 'festival']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
function editor(u: AccessTokenPayload) {
  if (!['editor', 'admin', 'super_admin'].includes(u.role)) throw new ForbiddenException();
}
@Controller({ path: 'weekend', version: '1' })
export class WeekendController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('events')
  async events(@Query(new ZodPipe(browse)) q: z.infer<typeof browse>) {
    const now = new Date();
    const city = q.city ? await this.prisma.city.findUnique({ where: { slug: q.city } }) : null;
    const range = weekendRange(now, city?.timezone ?? 'Australia/Sydney');
    const where = {
      status: 'published',
      endsAt: { gt: now },
      startsAt: q.period === 'weekend' ? { lt: range.to } : undefined,
      ...(q.period === 'weekend' ? { AND: { endsAt: { gt: range.from } } } : {}),
      ...(q.free === 'true' ? { priceMinor: 0 } : {}),
      ...(q.family === 'true' ? { family: true } : {}),
      ...(q.indoor === 'true' ? { indoor: true } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(city ? { cityId: city.id } : {}),
      ...(q.suburb ? { suburb: { equals: q.suburb, mode: 'insensitive' as const } } : {}),
    };
    const [items, total, suburbs] = await Promise.all([
      this.prisma.weekendEvent.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * 20,
        take: 20,
      }),
      this.prisma.weekendEvent.count({ where }),
      this.prisma.weekendEvent.findMany({
        where: { status: 'published', endsAt: { gt: now }, ...(city ? { cityId: city.id } : {}) },
        distinct: ['suburb'],
        select: { suburb: true },
        orderBy: { suburb: 'asc' },
      }),
    ]);
    return {
      items,
      total,
      page: q.page,
      suburbs: suburbs.map((s) => s.suburb),
      weekend: range,
      timeZone: city?.timezone ?? 'Australia/Sydney',
    };
  }
  @Get('events/:id/calendar')
  async calendar(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const event = await this.prisma.weekendEvent.findFirst({
      where: { id, status: 'published', endsAt: { gt: new Date() } },
    });
    if (!event?.startsAt || !event.endsAt) throw new NotFoundException();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sydney-${id}.ics"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(calendar({ ...event, startsAt: event.startsAt, endsAt: event.endsAt }));
  }
  @Get('saved')
  @UseGuards(AuthGuard)
  async saved(@CurrentUser() u: AccessTokenPayload) {
    return this.prisma.weekendSave.findMany({
      where: { userId: u.sub },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
  @Post('events/:id/save')
  @UseGuards(AuthGuard)
  async save(@CurrentUser() u: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    if (
      !(await this.prisma.weekendEvent.findFirst({
        where: { id, status: 'published', endsAt: { gt: new Date() } },
      }))
    )
      throw new NotFoundException();
    return this.prisma.weekendSave.upsert({
      where: { userId_eventId: { userId: u.sub, eventId: id } },
      create: { userId: u.sub, eventId: id },
      update: {},
    });
  }
  @Delete('events/:id/save')
  @UseGuards(AuthGuard)
  async unsave(@CurrentUser() u: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.weekendSave.deleteMany({ where: { userId: u.sub, eventId: id } });
    return { ok: true };
  }
  @Get('admin/sources')
  @UseGuards(AuthGuard)
  async sources(@CurrentUser() u: AccessTokenPayload) {
    editor(u);
    return {
      enabled: process.env.WEEKEND_COLLECTOR_ENABLED === 'true',
      items: await this.prisma.weekendSource.findMany({ orderBy: { id: 'asc' } }),
    };
  }
  @Get('admin/events')
  @UseGuards(AuthGuard)
  async pending(
    @CurrentUser() u: AccessTokenPayload,
    @Query(
      new ZodPipe(
        z.object({
          status: z.enum(['pending', 'published', 'rejected', 'cancelled']).default('pending'),
          page: z.coerce.number().int().min(1).max(1000).default(1),
        }),
      ),
    )
    q: { status: string; page: number },
  ) {
    editor(u);
    const where = { status: q.status };
    return {
      items: await this.prisma.weekendEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * 20,
        take: 20,
      }),
      total: await this.prisma.weekendEvent.count({ where }),
    };
  }
  @Post('admin/events')
  @UseGuards(AuthGuard)
  async create(
    @CurrentUser() u: AccessTokenPayload,
    @Body(new ZodPipe(eventInput)) body: z.infer<typeof eventInput>,
  ) {
    editor(u);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.weekendEvent.create({
        data: { ...body, fingerprint: `manual:${randomUUID()}` },
      });
      await tx.auditLog.create({
        data: { actorId: u.sub, action: 'weekend.create', subject: row.id },
      });
      return row;
    });
  }
  @Patch('admin/events/:id')
  @UseGuards(AuthGuard)
  async review(
    @CurrentUser() u: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewInput)) body: z.infer<typeof reviewInput>,
  ) {
    editor(u);
    const { updatedAt, ...data } = body;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.weekendEvent.updateMany({
        where: { id, updatedAt: new Date(updatedAt) },
        data: { ...data, reviewedAt: new Date() },
      });
      if (!result.count) throw new ConflictException('Event changed; reload before saving');
      await tx.auditLog.create({
        data: { actorId: u.sub, action: `weekend.${body.status}`, subject: id },
      });
      return tx.weekendEvent.findUniqueOrThrow({ where: { id } });
    });
  }
}
