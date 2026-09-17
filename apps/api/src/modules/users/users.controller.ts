import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { consentSchema, notificationPrefsSchema, updateProfileSchema } from '@aucn/domain';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

const pushSubSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(10).max(200),
    auth: z.string().min(10).max(200),
  }),
});

export interface MeDto {
  id: string;
  displayName: string;
  role: string;
  locale: string;
  bio: string | null;
  homeCityId: string | null;
  email: string | null;
  interests: string[];
  avatarMediaId: string | null;
  birthYear: number | null;
  totpEnabled: boolean;
  notificationPrefs: Record<string, unknown> | null;
  marketingOptOut: boolean;
  personalizationOff: boolean;
  onboardedAt: string | null;
  deletionRequestedAt: string | null;
  createdAt: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  private async profile(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identities: { where: { provider: 'email_otp', revokedAt: null }, take: 1 } },
    });
    if (!row) throw new NotFoundException();
    return row;
  }

  @Get()
  async me(@CurrentUser() user: AccessTokenPayload): Promise<MeDto> {
    const row = await this.profile(user.sub);
    return {
      id: row.id,
      displayName: row.displayName,
      role: row.role,
      locale: row.locale,
      bio: row.bio,
      homeCityId: row.homeCityId,
      email: row.identities[0]?.providerSubject ?? null,
      interests: row.interests,
      avatarMediaId: row.avatarMediaId,
      birthYear: row.birthYear,
      totpEnabled: !!row.totpEnabledAt,
      notificationPrefs: (row.notificationPrefs as Record<string, unknown> | null) ?? null,
      marketingOptOut: !!row.marketingOptOutAt,
      personalizationOff: row.personalizationOff,
      onboardedAt: row.onboardedAt?.toISOString() ?? null,
      deletionRequestedAt: row.deletionRequestedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
  ): Promise<MeDto> {
    const { onboarded, avatarMediaId, marketingOptOut, ...data } = body;
    if (avatarMediaId) {
      const media = await this.prisma.media.findUnique({ where: { id: avatarMediaId } });
      if (!media || media.ownerId !== user.sub || media.purpose !== 'avatar')
        throw new ForbiddenException('Not your avatar media');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.sub },
        data: {
          ...data,
          avatarMediaId: avatarMediaId === undefined ? undefined : avatarMediaId,
          ...(onboarded ? { onboardedAt: new Date() } : {}),
          ...(marketingOptOut === undefined
            ? {}
            : { marketingOptOutAt: marketingOptOut ? new Date() : null }),
        },
      });
      if (marketingOptOut !== undefined) {
        await tx.consentRecord.create({
          data: {
            userId: user.sub,
            kind: 'marketing',
            version: 'v1',
            granted: !marketingOptOut,
          },
        });
      }
    });
    return this.me(user);
  }

  // ---------- Identities (bind/unbind, §5.1) ----------

  @Get('identities')
  async identities(@CurrentUser() user: AccessTokenPayload) {
    const rows = await this.prisma.identity.findMany({
      where: { userId: user.sub, revokedAt: null },
      select: {
        id: true,
        provider: true,
        providerSubject: true,
        verifiedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    // Never expose full OAuth subjects; email is safe for the owner.
    return {
      items: rows.map((i) => ({
        ...i,
        providerSubject:
          i.provider === 'email_otp' || i.provider === 'phone_otp'
            ? i.providerSubject
            : `${i.providerSubject.slice(0, 4)}…`,
      })),
    };
  }

  @Delete('identities/:id')
  async unbindIdentity(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const identity = await this.prisma.identity.findUnique({ where: { id } });
    if (!identity || identity.userId !== user.sub || identity.revokedAt)
      throw new NotFoundException();
    const remaining = await this.prisma.identity.count({
      where: { userId: user.sub, revokedAt: null, id: { not: id } },
    });
    if (remaining === 0) throw new UnprocessableEntityException('Keep at least one way to sign in');
    await this.prisma.identity.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action: 'identity.unbind',
        subject: `user:${user.sub}`,
        metadata: { provider: identity.provider },
      },
    });
    return { ok: true };
  }

  // ---------- Notification preferences & consent ----------

  @Put('notification-prefs')
  async setNotificationPrefs(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(notificationPrefsSchema))
    body: z.infer<typeof notificationPrefsSchema>,
  ) {
    const current = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { notificationPrefs: true },
    });
    const merged = { ...(current?.notificationPrefs as object), ...body };
    await this.prisma.user.update({
      where: { id: user.sub },
      data: { notificationPrefs: merged },
    });
    return { notificationPrefs: merged };
  }

  @Post('consents')
  async recordConsent(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(consentSchema)) body: z.infer<typeof consentSchema>,
  ) {
    await this.prisma.consentRecord.create({
      data: { userId: user.sub, kind: body.kind, version: body.version, granted: body.granted },
    });
    return { ok: true };
  }

  @Get('consents')
  async consents(@CurrentUser() user: AccessTokenPayload) {
    const rows = await this.prisma.consentRecord.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, version: true, granted: true, createdAt: true },
    });
    return { items: rows };
  }

  // ---------- Web Push subscriptions (§5.9 push 通道) ----------

  @Post('push-subscriptions')
  async subscribePush(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(pushSubSchema)) body: z.infer<typeof pushSubSchema>,
  ) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { userId: user.sub, p256dh: body.keys.p256dh, auth: body.keys.auth },
      create: {
        userId: user.sub,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });
    return { ok: true };
  }

  @Delete('push-subscriptions')
  async unsubscribePush(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(z.object({ endpoint: z.string().url().max(1000) })))
    body: {
      endpoint: string;
    },
  ) {
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: user.sub },
    });
    return { ok: true };
  }

  // ---------- Sessions ----------

  @Get('sessions')
  async sessions(@CurrentUser() user: AccessTokenPayload) {
    const rows = await this.prisma.session.findMany({
      where: { userId: user.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        lastSeenAt: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return {
      items: rows.map((s) => ({ ...s, current: s.id === user.sid })),
    };
  }

  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Use POST /auth/logout to end the current session; remote revoke is for other devices.
    if (id === user.sid) throw new ForbiddenException('Use logout to end the current session');
    const result = await this.prisma.session.updateMany({
      where: { id, userId: user.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }

  // ---------- Invoices (§9) ----------

  @Get('invoices')
  async invoices(@CurrentUser() user: AccessTokenPayload) {
    const rows = await this.prisma.invoice.findMany({
      where: { ownerId: user.sub },
      orderBy: { issuedAt: 'desc' },
      include: { payment: { select: { kind: true, listingId: true } } },
      take: 100,
    });
    return { items: rows };
  }

  // ---------- Account deletion (grace period, swept by UsersDeletionWorker) ----------

  @Post('deletion')
  async requestDeletion(@CurrentUser() user: AccessTokenPayload) {
    const me = await this.profile(user.sub);
    if (me.deletionRequestedAt) throw new ConflictException('Deletion already requested');
    const updated = await this.prisma.user.update({
      where: { id: user.sub },
      data: { deletionRequestedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'user.deletion.request', subject: `user:${user.sub}` },
    });
    return {
      deletionRequestedAt: updated.deletionRequestedAt!.toISOString(),
      effectiveAfterDays: Number(process.env.DELETION_GRACE_DAYS ?? 7),
    };
  }

  @Delete('deletion')
  async cancelDeletion(@CurrentUser() user: AccessTokenPayload) {
    await this.prisma.user.update({
      where: { id: user.sub },
      data: { deletionRequestedAt: null },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'user.deletion.cancel', subject: `user:${user.sub}` },
    });
    return { ok: true };
  }

  // ---------- Data export ----------

  @Get('export')
  async export(@CurrentUser() user: AccessTokenPayload) {
    const me = await this.profile(user.sub);
    const [
      identities,
      listings,
      posts,
      comments,
      messages,
      favorites,
      follows,
      savedSearches,
      payments,
      consents,
    ] = await Promise.all([
      this.prisma.identity.findMany({ where: { userId: user.sub } }),
      this.prisma.listing.findMany({
        where: { ownerId: user.sub },
        include: { housing: true, job: true, item: true, service: true },
      }),
      this.prisma.post.findMany({ where: { authorId: user.sub } }),
      this.prisma.comment.findMany({ where: { authorId: user.sub } }),
      this.prisma.message.findMany({ where: { senderId: user.sub } }),
      this.prisma.favorite.findMany({ where: { userId: user.sub } }),
      this.prisma.follow.findMany({ where: { userId: user.sub } }),
      this.prisma.savedSearch.findMany({ where: { userId: user.sub } }),
      this.prisma.payment.findMany({ where: { ownerId: user.sub } }),
      this.prisma.consentRecord.findMany({ where: { userId: user.sub } }),
    ]);
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'user.export', subject: `user:${user.sub}` },
    });
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: me.id,
        displayName: me.displayName,
        role: me.role,
        locale: me.locale,
        bio: me.bio,
        homeCityId: me.homeCityId,
        interests: me.interests,
        birthYear: me.birthYear,
        createdAt: me.createdAt,
        lastLoginAt: me.lastLoginAt,
      },
      identities: identities.map((i) => ({
        provider: i.provider,
        providerSubject: i.provider === 'email_otp' ? i.providerSubject : undefined,
        verifiedAt: i.verifiedAt,
        revokedAt: i.revokedAt,
      })),
      listings,
      posts,
      comments,
      messages,
      favorites,
      follows,
      savedSearches,
      payments,
      consents,
    };
  }
}

/** Public user profiles (§5.2 用户主页): display name, bio, public content counts. */
@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class PublicUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async publicProfile(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, status: 'active' },
      select: {
        id: true,
        displayName: true,
        bio: true,
        avatarMediaId: true,
        createdAt: true,
        _count: {
          select: {
            posts: { where: { status: 'published', anonymous: false } },
            listings: { where: { status: { in: ['active', 'reserved', 'paused'] } } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException();
    const listings = await this.prisma.listing.findMany({
      where: {
        ownerId: id,
        status: { in: ['active', 'reserved'] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { publishedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        type: true,
        title: true,
        priceMinor: true,
        currency: true,
        publishedAt: true,
      },
    });
    return {
      id: user.id,
      displayName: user.displayName,
      bio: user.bio,
      avatarMediaId: user.avatarMediaId,
      memberSince: user.createdAt,
      postCount: user._count.posts,
      listings,
    };
  }
}
