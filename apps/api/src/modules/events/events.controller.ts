import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  UnprocessableEntityException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eventSchema, EVENT_CATEGORIES } from '@aucn/domain';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { cursorQuerySchema, decodeCursor } from '../../common/pagination';
import { AuthGuard, OptionalAuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = cursorQuerySchema.extend({
  cityId: z.string().uuid().optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
  past: z.coerce.boolean().optional(),
});
const eventUpdate = eventSchema.partial().extend({ updatedAt: z.string().datetime() });

const EVENT_EDIT_ROLES = ['moderator', 'admin', 'super_admin'];

@ApiTags('events')
@Controller({ path: 'events', version: '1' })
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Keyset pagination on (startsAt, id) so upcoming events sort first. */
  @Get()
  async list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    const c = decodeCursor(query.cursor);
    const rows = await this.prisma.event.findMany({
      where: {
        status: 'published',
        ...(query.past ? {} : { endsAt: { gt: new Date() } }),
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(c
          ? {
              OR: [{ startsAt: { gt: c.createdAt } }, { startsAt: c.createdAt, id: { gt: c.id } }],
            }
          : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: {
        city: { select: { id: true, slug: true, nameZh: true, nameEn: true } },
        organizer: { select: { id: true, displayName: true } },
        _count: { select: { rsvps: { where: { status: 'going' } } } },
      },
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];
    return {
      items: items.map((e) => ({ ...e, goingCount: e._count.rsvps })),
      nextCursor:
        hasMore && last
          ? Buffer.from(`${last.startsAt.toISOString()}|${last.id}`).toString('base64url')
          : null,
    };
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AccessTokenPayload) {
    const e = await this.prisma.event.findUnique({
      where: { id },
      include: {
        city: { select: { id: true, slug: true, nameZh: true, nameEn: true, timezone: true } },
        organizer: { select: { id: true, displayName: true } },
        _count: { select: { rsvps: { where: { status: 'going' } } } },
      },
    });
    const isOrganizer =
      !!user && (e?.organizerId === user.sub || EVENT_EDIT_ROLES.includes(user.role));
    if (!e || (e.status !== 'published' && !isOrganizer)) throw new NotFoundException();
    const viewerRsvp = user
      ? await this.prisma.eventRsvp.findUnique({
          where: { eventId_userId: { eventId: id, userId: user.sub } },
          select: { status: true, checkinCode: true, checkedInAt: true },
        })
      : null;
    return {
      ...e,
      goingCount: e._count.rsvps,
      viewerRsvp: viewerRsvp?.status ?? null,
      // The attendee sees their own QR check-in code; the organizer scans it at the door.
      checkinCode: viewerRsvp?.checkinCode ?? null,
      checkedInAt: viewerRsvp?.checkedInAt ?? null,
      viewerIsOrganizer: isOrganizer,
    };
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(eventSchema)) body: z.infer<typeof eventSchema>,
  ) {
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) throw new UnprocessableEntityException('endsAt must be after startsAt');
    const event = await this.prisma.event.create({
      data: { ...body, startsAt, endsAt, organizerId: user.sub },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'event.create', subject: `event:${event.id}` },
    });
    return event;
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(eventUpdate)) body: z.infer<typeof eventUpdate>,
  ) {
    const e = await this.prisma.event.findUnique({ where: { id } });
    if (!e || e.status === 'removed') throw new NotFoundException();
    if (e.organizerId !== user.sub && !EVENT_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('Only the organizer can edit');
    const { updatedAt, ...data } = body;
    const updated = await this.prisma.event.update({
      where: { id, updatedAt: new Date(updatedAt) },
      data: {
        ...data,
        ...(data.startsAt ? { startsAt: new Date(data.startsAt) } : {}),
        ...(data.endsAt ? { endsAt: new Date(data.endsAt) } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'event.update', subject: `event:${id}` },
    });
    return updated;
  }

  @Post(':id/cancel')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async cancel(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.prisma.event.findUnique({ where: { id } });
    if (!e || e.status === 'removed') throw new NotFoundException();
    if (e.organizerId !== user.sub && !EVENT_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('Only the organizer can cancel');
    await this.prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id }, data: { status: 'cancelled' } });
      const attendees = await tx.eventRsvp.findMany({ where: { eventId: id } });
      for (const r of attendees)
        await tx.notification.create({
          data: { userId: r.userId, kind: 'event.cancelled', subjectId: id },
        });
      await tx.auditLog.create({
        data: { actorId: user.sub, action: 'event.cancel', subject: `event:${id}` },
      });
    });
    return { ok: true };
  }

  // ---------- RSVP ----------

  @Post(':id/rsvp')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async rsvp(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.prisma.event.findUnique({ where: { id } });
    if (!e || e.status !== 'published' || e.endsAt <= new Date()) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.eventRsvp.findUnique({
        where: { eventId_userId: { eventId: id, userId: user.sub } },
      });
      if (existing) return existing;
      const going = await tx.eventRsvp.count({ where: { eventId: id, status: 'going' } });
      const status = e.capacity !== null && going >= e.capacity ? 'waitlist' : 'going';
      const rsvp = await tx.eventRsvp.create({
        data: {
          eventId: id,
          userId: user.sub,
          status,
          checkinCode: randomBytes(8).toString('hex'),
        },
      });
      await tx.notification.create({
        data: { userId: e.organizerId, kind: 'event.rsvp', subjectId: id },
      });
      return rsvp;
    });
  }

  @Delete(':id/rsvp')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async cancelRsvp(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.eventRsvp.deleteMany({
        where: { eventId: id, userId: user.sub },
      });
      if (!removed.count) throw new NotFoundException();
      // Promote the earliest waitlisted attendee when a seat frees up.
      const event = await tx.event.findUnique({ where: { id } });
      if (event?.capacity) {
        const going = await tx.eventRsvp.count({ where: { eventId: id, status: 'going' } });
        if (going < event.capacity) {
          const next = await tx.eventRsvp.findFirst({
            where: { eventId: id, status: 'waitlist' },
            orderBy: { createdAt: 'asc' },
          });
          if (next) {
            await tx.eventRsvp.update({ where: { id: next.id }, data: { status: 'going' } });
            await tx.notification.create({
              data: { userId: next.userId, kind: 'event.promoted', subjectId: id },
            });
          }
        }
      }
    });
    return { ok: true };
  }

  // ---------- QR check-in (§5.7) ----------

  /** Organizer scans the attendee's check-in code to mark them present. */
  @Post(':id/checkin')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async checkin(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ code: z.string().min(6).max(64) }))) body: { code: string },
  ) {
    const e = await this.prisma.event.findUnique({ where: { id } });
    if (!e) throw new NotFoundException();
    if (e.organizerId !== user.sub && !EVENT_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('Only the organizer can check in attendees');
    const rsvp = await this.prisma.eventRsvp.findFirst({
      where: { eventId: id, checkinCode: body.code },
      include: { user: { select: { id: true, displayName: true } } },
    });
    if (!rsvp) throw new NotFoundException('Invalid check-in code');
    if (!rsvp.checkedInAt)
      await this.prisma.eventRsvp.update({
        where: { id: rsvp.id },
        data: { checkedInAt: new Date() },
      });
    return { user: rsvp.user, status: rsvp.status, checkedInAt: rsvp.checkedInAt ?? new Date() };
  }

  // ---------- ICS ----------

  @Get(':id/ics')
  @Header('content-type', 'text/calendar; charset=utf-8')
  async ics(@Param('id', ParseUUIDPipe) id: string) {
    const e = await this.prisma.event.findUnique({ where: { id } });
    if (!e || e.status !== 'published') throw new NotFoundException();
    const fmt = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    const esc = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AUCN Hub//Events//EN',
      'BEGIN:VEVENT',
      `UID:${e.id}@aucnhub`,
      `DTSTAMP:${fmt(e.createdAt)}`,
      `DTSTART:${fmt(e.startsAt)}`,
      `DTEND:${fmt(e.endsAt)}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.body.slice(0, 500))}`,
      e.venue ? `LOCATION:${esc(e.venue)}` : undefined,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n');
  }
}
