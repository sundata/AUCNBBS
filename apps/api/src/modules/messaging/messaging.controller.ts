import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';
import { isPubliclyVisible } from '@aucn/domain';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessTokenPayload } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ZodPipe } from '../../common/zod.pipe';
import { cursorQuerySchema, CursorQuery, decodeCursor, toPage } from '../../common/pagination';
const startSchema = z.object({ listingId: z.string().uuid() });
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const pageWhere = (query: CursorQuery) => {
  const c = decodeCursor(query.cursor);
  return c
    ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
    : {};
};
@Controller({ path: 'messages', version: '1' })
@UseGuards(AuthGuard)
export class MessagingController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('conversations')
  async start(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(startSchema)) body: z.infer<typeof startSchema>,
  ) {
    const listing = await this.prisma.listing.findUnique({ where: { id: body.listingId } });
    if (!listing || !isPubliclyVisible(listing.status, listing.expiresAt))
      throw new NotFoundException();
    if (listing.ownerId === user.sub)
      throw new UnprocessableEntityException('Cannot contact yourself');
    return this.prisma.conversation.upsert({
      where: { listingId_buyerId: { listingId: listing.id, buyerId: user.sub } },
      update: {},
      create: { listingId: listing.id, buyerId: user.sub, sellerId: listing.ownerId },
      select: { id: true },
    });
  }

  @Get('conversations')
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const rows = await this.prisma.conversation.findMany({
      where: { AND: [{ OR: [{ buyerId: user.sub }, { sellerId: user.sub }] }, pageWhere(query)] },
      include: {
        listing: { select: { title: true } },
        buyer: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
        _count: { select: { messages: { where: { senderId: { not: user.sub }, readAt: null } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(
      rows.map((row) => ({
        id: row.id,
        title: row.listing.title,
        peer: row.buyerId === user.sub ? row.seller : row.buyer,
        unread: row._count.messages,
        createdAt: row.createdAt,
      })),
      query.limit,
    );
  }

  private async member(id: string, userId: string) {
    const row = await this.prisma.conversation.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
    });
    if (!row) throw new NotFoundException();
    return row;
  }

  @Get('conversations/:id')
  async messages(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    await this.member(id, user.sub);
    return toPage(
      await this.prisma.message.findMany({
        where: { conversationId: id, ...pageWhere(query) },
        select: { id: true, senderId: true, body: true, createdAt: true, readAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  @Post('conversations/:id/read')
  async read(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.member(id, user.sub);
    await this.prisma.$transaction([
      this.prisma.message.updateMany({
        where: { conversationId: id, senderId: { not: user.sub }, readAt: null },
        data: { readAt: new Date() },
      }),
      this.prisma.notification.updateMany({
        where: { userId: user.sub, subjectId: id, kind: 'message', readAt: null },
        data: { readAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  @Post('conversations/:id')
  async send(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(messageSchema)) body: z.infer<typeof messageSchema>,
  ) {
    const conversation = await this.member(id, user.sub);
    const recipientId =
      conversation.buyerId === user.sub ? conversation.sellerId : conversation.buyerId;
    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient || recipient.status !== 'active')
      throw new UnprocessableEntityException('Recipient unavailable');
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { conversationId: id, senderId: user.sub, body: body.body },
      });
      await tx.notification.create({
        data: { userId: recipientId, kind: 'message', subjectId: id },
      });
      return {
        id: message.id,
        senderId: message.senderId,
        body: message.body,
        createdAt: message.createdAt,
        readAt: message.readAt,
      };
    });
  }

  @Post('notifications/:id/read')
  async readNotification(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId: user.sub },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }

  @Get('notifications')
  async notifications(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    return toPage(
      await this.prisma.notification.findMany({
        where: { userId: user.sub, ...pageWhere(query) },
        select: { id: true, kind: true, subjectId: true, readAt: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      query.limit,
    );
  }
}
