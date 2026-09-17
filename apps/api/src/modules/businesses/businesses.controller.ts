import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  businessClaimSchema,
  businessLeadSchema,
  businessLocationSchema,
  businessMemberSchema,
  businessReplySchema,
  businessReviewSchema,
  businessSchema,
  offerSchema,
  updateLeadSchema,
  BUSINESS_CATEGORIES,
} from '@aucn/domain';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { notify } from '../../common/notify';
import { cursorQuerySchema, CursorQuery, decodeCursor, toPage } from '../../common/pagination';
import { AuthGuard, OptionalAuthGuard } from '../auth/auth.guard';
import { AccessTokenPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = cursorQuerySchema.extend({
  cityId: z.string().uuid().optional(),
  category: z.enum(BUSINESS_CATEGORIES).optional(),
  q: z.string().trim().max(120).optional(),
});

const BUSINESS_EDIT_ROLES = ['admin', 'super_admin'];

function pageWhere(query: CursorQuery) {
  const c = decodeCursor(query.cursor);
  return c
    ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
    : {};
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'business'}-${randomBytes(3).toString('hex')}`;
}

@ApiTags('businesses')
@Controller({ path: 'businesses', version: '1' })
export class BusinessesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    const rows = await this.prisma.business.findMany({
      where: {
        status: 'active',
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.q
          ? {
              OR: [
                { nameZh: { contains: query.q, mode: 'insensitive' } },
                { nameEn: { contains: query.q, mode: 'insensitive' } },
                { descriptionZh: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...pageWhere(query),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        city: { select: { id: true, slug: true, nameZh: true, nameEn: true } },
        _count: { select: { reviews: { where: { status: 'published' } } } },
      },
    });
    return toPage(
      rows.map((b) => ({
        id: b.id,
        slug: b.slug,
        nameZh: b.nameZh,
        nameEn: b.nameEn,
        category: b.category,
        suburb: b.suburb,
        city: b.city,
        claimed: !!b.claimedById,
        reviewCount: b._count.reviews,
        createdAt: b.createdAt,
      })),
      query.limit,
    );
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AccessTokenPayload) {
    const b = await this.prisma.business.findUnique({
      where: { id },
      include: {
        city: { select: { id: true, slug: true, nameZh: true, nameEn: true } },
        claimedBy: { select: { id: true, displayName: true } },
        locations: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        offers: {
          where: { status: 'active', endsAt: { gt: new Date() } },
          orderBy: { endsAt: 'asc' },
        },
      },
    });
    const isOwner =
      !!user && (b?.claimedById === user.sub || BUSINESS_EDIT_ROLES.includes(user.role));
    if (!b || (b.status !== 'active' && !isOwner)) throw new NotFoundException();
    const aggregate = await this.prisma.businessReview.aggregate({
      where: { businessId: id, status: 'published' },
      _avg: { rating: true },
      _count: true,
    });
    const { claimedBy, ...rest } = b;
    return {
      ...rest,
      claimed: !!b.claimedById,
      owner: claimedBy ? { id: claimedBy.id, displayName: claimedBy.displayName } : null,
      ratingAvg: aggregate._avg.rating,
      reviewCount: aggregate._count,
      viewerIsOwner: isOwner,
    };
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(businessSchema)) body: z.infer<typeof businessSchema>,
  ) {
    const business = await this.prisma.business.create({
      data: { ...body, slug: slugify(body.nameEn ?? body.nameZh), createdById: user.sub },
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'business.create', subject: `business:${business.id}` },
    });
    return business;
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(businessSchema.partial())) body: z.infer<typeof businessSchema>,
  ) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b || b.status === 'removed') throw new NotFoundException();
    if (b.claimedById !== user.sub && !BUSINESS_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('Only the claimed owner or staff can edit');
    return this.prisma.business.update({ where: { id }, data: body });
  }

  // ---------- Claim ----------

  @Post(':id/claim')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async claim(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(businessClaimSchema)) body: z.infer<typeof businessClaimSchema>,
  ) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b || b.status !== 'active') throw new NotFoundException();
    if (b.claimedById) throw new ConflictException('Business already claimed');
    const existing = await this.prisma.businessClaim.findFirst({
      where: { businessId: id, claimantId: user.sub, status: 'pending' },
    });
    if (existing) throw new ConflictException('Claim already pending');
    const claim = await this.prisma.businessClaim.create({
      data: { businessId: id, claimantId: user.sub, evidence: body.evidence },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action: 'business.claim.request',
        subject: `business:${id}`,
        metadata: { claimId: claim.id },
      },
    });
    return claim;
  }

  // ---------- Reviews ----------

  @Get(':id/reviews')
  async reviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const b = await this.prisma.business.findUnique({ where: { id }, select: { status: true } });
    if (!b || b.status !== 'active') throw new NotFoundException();
    return toPage(
      await this.prisma.businessReview.findMany({
        where: { businessId: id, status: 'published', ...pageWhere(query) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: { author: { select: { id: true, displayName: true, avatarMediaId: true } } },
      }),
      query.limit,
    );
  }

  @Post(':id/reviews')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async review(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(businessReviewSchema)) body: z.infer<typeof businessReviewSchema>,
  ) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b || b.status !== 'active') throw new NotFoundException();
    if (b.claimedById === user.sub)
      throw new ForbiddenException('Owners cannot review their own business');
    // §5.6 评价最低互动信号：account must be a day old or have other activity.
    const reviewer = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { createdAt: true, _count: { select: { comments: true, favorites: true } } },
    });
    const hasSignal =
      !!reviewer &&
      (Date.now() - reviewer.createdAt.getTime() > 86_400_000 ||
        reviewer._count.comments + reviewer._count.favorites > 0);
    if (!hasSignal) throw new ForbiddenException('Account needs some activity before reviewing');
    try {
      return await this.prisma.businessReview.create({
        data: { businessId: id, authorId: user.sub, ...body },
        include: { author: { select: { id: true, displayName: true } } },
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2002')
        throw new ConflictException('You have already reviewed this business');
      throw error;
    }
  }

  @Post(':id/reviews/:reviewId/reply')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async reply(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body(new ZodPipe(businessReplySchema)) body: z.infer<typeof businessReplySchema>,
  ) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b) throw new NotFoundException();
    if (b.claimedById !== user.sub && !BUSINESS_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('Only the claimed owner can reply');
    const result = await this.prisma.businessReview.updateMany({
      where: { id: reviewId, businessId: id },
      data: { reply: body.reply, repliedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException();
    return this.prisma.businessReview.findUnique({ where: { id: reviewId } });
  }

  // ---------- Membership helper ----------

  /** Claimed owner, business member (manager+ for writes), or staff role. */
  private async assertMember(id: string, user: AccessTokenPayload, write = false) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b || b.status === 'removed') throw new NotFoundException();
    if (BUSINESS_EDIT_ROLES.includes(user.role) || b.claimedById === user.sub) return b;
    const member = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId: id, userId: user.sub } },
    });
    if (!member) throw new ForbiddenException('Not a member of this business');
    if (write && member.role === 'staff')
      throw new ForbiddenException('Insufficient business role');
    return b;
  }

  // ---------- Locations (多门店) ----------

  @Get(':id/locations')
  async locations(@Param('id', ParseUUIDPipe) id: string) {
    return {
      items: await this.prisma.businessLocation.findMany({
        where: { businessId: id },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
    };
  }

  @Post(':id/locations')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async addLocation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(businessLocationSchema)) body: z.infer<typeof businessLocationSchema>,
  ) {
    const b = await this.assertMember(id, user, true);
    const count = await this.prisma.businessLocation.count({ where: { businessId: id } });
    // Multi-store is a Pro feature (§9.1): free tier gets one location card.
    if (count >= 1) {
      const pro = await this.prisma.subscription.findFirst({
        where: { businessId: id, kind: 'business_pro', status: 'active' },
      });
      if (!pro && !(b.claimedById === user.sub && BUSINESS_EDIT_ROLES.includes(user.role)))
        throw new ForbiddenException('Multi-location requires a Business Pro subscription');
    }
    if (body.isPrimary)
      await this.prisma.businessLocation.updateMany({
        where: { businessId: id },
        data: { isPrimary: false },
      });
    return this.prisma.businessLocation.create({ data: { ...body, businessId: id } });
  }

  @Delete(':id/locations/:locationId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async removeLocation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    await this.assertMember(id, user, true);
    await this.prisma.businessLocation.deleteMany({
      where: { id: locationId, businessId: id },
    });
    return { ok: true };
  }

  // ---------- Members (多成员角色) ----------

  @Get(':id/members')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async members(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertMember(id, user);
    return {
      items: await this.prisma.businessMember.findMany({
        where: { businessId: id },
        include: { user: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    };
  }

  @Post(':id/members')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async addMember(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(businessMemberSchema)) body: z.infer<typeof businessMemberSchema>,
  ) {
    const b = await this.assertMember(id, user, true);
    if (b.claimedById !== user.sub && !BUSINESS_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('Only the owner can add members');
    return this.prisma.businessMember.upsert({
      where: { businessId_userId: { businessId: id, userId: body.userId } },
      update: { role: body.role },
      create: { businessId: id, userId: body.userId, role: body.role },
    });
  }

  @Delete(':id/members/:userId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async removeMember(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const b = await this.assertMember(id, user, true);
    if (b.claimedById !== user.sub && !BUSINESS_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('Only the owner can remove members');
    await this.prisma.businessMember.deleteMany({
      where: { businessId: id, userId },
    });
    return { ok: true };
  }

  // ---------- Leads inbox (线索收件箱) ----------

  @Post(':id/leads')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @UseGuards(OptionalAuthGuard)
  async lead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(businessLeadSchema)) body: z.infer<typeof businessLeadSchema>,
    @CurrentUser() user?: AccessTokenPayload,
  ) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b || b.status !== 'active') throw new NotFoundException();
    const lead = await this.prisma.businessLead.create({
      data: { ...body, businessId: id, fromUserId: user?.sub },
    });
    if (b.claimedById)
      await notify(this.prisma, b.claimedById, 'lead.new', id, { leadId: lead.id });
    return { id: lead.id };
  }

  @Get(':id/leads')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async leads(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    await this.assertMember(id, user);
    return toPage(
      await this.prisma.businessLead.findMany({
        where: { businessId: id, ...pageWhere(query) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  @Patch(':id/leads/:leadId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async updateLead(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body(new ZodPipe(updateLeadSchema)) body: z.infer<typeof updateLeadSchema>,
  ) {
    await this.assertMember(id, user);
    const result = await this.prisma.businessLead.updateMany({
      where: { id: leadId, businessId: id },
      data: { status: body.status },
    });
    if (!result.count) throw new NotFoundException();
    return { ok: true };
  }

  /** CSV export needs an active Business Pro subscription (§5.6/§9.1). */
  @Get(':id/leads.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async leadsCsv(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertMember(id, user);
    const pro = await this.prisma.subscription.findFirst({
      where: { businessId: id, kind: 'business_pro', status: 'active' },
    });
    if (!pro && !BUSINESS_EDIT_ROLES.includes(user.role))
      throw new ForbiddenException('CSV export requires a Business Pro subscription');
    const rows = await this.prisma.businessLead.findMany({
      where: { businessId: id },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'business.leads.export', subject: `business:${id}` },
    });
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    return [
      'created_at,name,contact,message,source,status',
      ...rows.map((r) =>
        [
          r.createdAt.toISOString(),
          esc(r.name),
          esc(r.contact),
          esc(r.message),
          r.source,
          r.status,
        ].join(','),
      ),
    ].join('\n');
  }

  // ---------- Offers (优惠) ----------

  @Get(':id/offers')
  async offers(@Param('id', ParseUUIDPipe) id: string) {
    return {
      items: await this.prisma.offer.findMany({
        where: { businessId: id, status: 'active', endsAt: { gt: new Date() } },
        orderBy: { endsAt: 'asc' },
      }),
    };
  }

  @Post(':id/offers')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async addOffer(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(offerSchema)) body: z.infer<typeof offerSchema>,
  ) {
    await this.assertMember(id, user, true);
    return this.prisma.offer.create({
      data: {
        ...body,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        businessId: id,
      },
    });
  }

  @Delete(':id/offers/:offerId')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  async removeOffer(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    await this.assertMember(id, user, true);
    await this.prisma.offer.updateMany({
      where: { id: offerId, businessId: id },
      data: { status: 'ended' },
    });
    return { ok: true };
  }
}
