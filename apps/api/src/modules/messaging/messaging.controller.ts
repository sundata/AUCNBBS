import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { containsLink, maskSensitiveNumbers } from '../../common/risk';
import { notify } from '../../common/notify';
import { cursorQuerySchema, CursorQuery, decodeCursor, toPage } from '../../common/pagination';

const startSchema = z.object({ listingId: z.string().uuid() });
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const blockSchema = z.object({ userId: z.string().uuid() });
const RECALL_WINDOW_MS = 10 * 60_000;
const REQUEST_MESSAGE_LIMIT = 3;

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

  private async assertNotBlocked(a: string, b: string) {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    if (block) throw new ForbiddenException('Messaging is blocked between these accounts');
  }

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
    await this.assertNotBlocked(user.sub, listing.ownerId);
    return this.prisma.conversation.upsert({
      where: { listingId_buyerId: { listingId: listing.id, buyerId: user.sub } },
      update: {},
      create: {
        listingId: listing.id,
        buyerId: user.sub,
        sellerId: listing.ownerId,
        // §5.9 陌生人消息请求：recipient must accept before the thread is fully open.
        status: 'requested',
      },
      select: { id: true, status: true },
    });
  }

  @Get('conversations')
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const rows = await this.prisma.conversation.findMany({
      where: {
        AND: [
          { OR: [{ buyerId: user.sub }, { sellerId: user.sub }] },
          { status: { not: 'declined' } },
          pageWhere(query),
        ],
      },
      include: {
        listing: { select: { title: true, status: true, type: true } },
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
        listingStatus: row.listing.status,
        status: row.status,
        isRequest: row.status === 'requested' && row.sellerId === user.sub,
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
    const convo = await this.member(id, user.sub);
    const page = toPage(
      await this.prisma.message.findMany({
        where: { conversationId: id, ...pageWhere(query) },
        select: {
          id: true,
          senderId: true,
          body: true,
          createdAt: true,
          readAt: true,
          recalledAt: true,
          masked: true,
          hasLink: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      query.limit,
    );
    // §5.9 首条消息安全上下文卡 + 撤回占位（证据保留在库中）。
    const listing = await this.prisma.listing.findUnique({
      where: { id: convo.listingId },
      select: { id: true, title: true, type: true, status: true, priceMinor: true },
    });
    return {
      conversation: {
        id: convo.id,
        status: convo.status,
        isRecipient: convo.sellerId === user.sub,
        listing,
      },
      items: page.items.map((m) => ({
        ...m,
        body: m.recalledAt ? '' : m.body,
        recalled: !!m.recalledAt,
      })),
      nextCursor: page.nextCursor,
    };
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

  /** Recipient accepts or declines a stranger message request. */
  @Post('conversations/:id/respond')
  async respond(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ accept: z.boolean() }))) body: { accept: boolean },
  ) {
    const convo = await this.member(id, user.sub);
    if (convo.sellerId !== user.sub) throw new ForbiddenException('Only the recipient can respond');
    if (convo.status !== 'requested') return { status: convo.status };
    const status = body.accept ? 'active' : 'declined';
    await this.prisma.conversation.update({ where: { id }, data: { status } });
    return { status };
  }

  @Post('conversations/:id')
  async send(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(messageSchema)) body: z.infer<typeof messageSchema>,
  ) {
    const conversation = await this.member(id, user.sub);
    if (conversation.status === 'declined')
      throw new ForbiddenException('This message request was declined');
    const recipientId =
      conversation.buyerId === user.sub ? conversation.sellerId : conversation.buyerId;
    await this.assertNotBlocked(user.sub, recipientId);
    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient || recipient.status !== 'active')
      throw new UnprocessableEntityException('Recipient unavailable');
    // Stranger request cap: initiator gets a few messages until the recipient engages.
    if (conversation.status === 'requested' && conversation.buyerId === user.sub) {
      const sent = await this.prisma.message.count({
        where: { conversationId: id, senderId: user.sub },
      });
      if (sent >= REQUEST_MESSAGE_LIMIT)
        throw new ForbiddenException('Wait for the recipient to accept the request');
    }
    const masked = maskSensitiveNumbers(body.body);
    const hasLink = containsLink(masked.body);
    const message = await this.prisma.message.create({
      data: {
        conversationId: id,
        senderId: user.sub,
        body: masked.body,
        masked: masked.masked,
        hasLink,
      },
    });
    await notify(this.prisma, recipientId, 'message', id);
    return {
      id: message.id,
      senderId: message.senderId,
      body: message.body,
      masked: message.masked,
      hasLink: message.hasLink,
      createdAt: message.createdAt,
      readAt: message.readAt,
    };
  }

  /** Recall a message within 10 minutes; the original stays in the audit trail. */
  @Post(':id/recall')
  async recall(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    const message = await this.prisma.message.findUnique({ where: { id } });
    if (!message || message.senderId !== user.sub) throw new NotFoundException();
    if (message.recalledAt) return { ok: true };
    if (Date.now() - message.createdAt.getTime() > RECALL_WINDOW_MS)
      throw new ForbiddenException('Recall window has passed');
    await this.prisma.message.update({ where: { id }, data: { recalledAt: new Date() } });
    return { ok: true };
  }

  // ---------- Blocking (§5.9 拉黑) ----------

  @Post('blocks')
  async block(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(blockSchema)) body: z.infer<typeof blockSchema>,
  ) {
    if (body.userId === user.sub) throw new UnprocessableEntityException('Cannot block yourself');
    const target = await this.prisma.user.findUnique({ where: { id: body.userId } });
    if (!target) throw new NotFoundException();
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: user.sub, blockedId: body.userId } },
      update: {},
      create: { blockerId: user.sub, blockedId: body.userId },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'user.block', subject: `user:${body.userId}` },
    });
    return { ok: true };
  }

  @Delete('blocks/:userId')
  async unblock(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId: user.sub, blockedId: userId },
    });
    return { ok: true };
  }

  @Get('blocks')
  async blocks(@CurrentUser() user: AccessTokenPayload) {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: user.sub },
      include: { blocked: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map((r) => ({ user: r.blocked, createdAt: r.createdAt })) };
  }

  // ---------- Notifications ----------

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
        select: {
          id: true,
          kind: true,
          subjectId: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      query.limit,
    );
  }
}
