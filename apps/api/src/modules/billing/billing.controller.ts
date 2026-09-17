import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Headers,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  ConflictException,
  RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { adCampaignSchema, isPubliclyVisible, SUBSCRIPTION_KINDS } from '@aucn/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessTokenPayload } from '../auth/auth.service';
import { ZodPipe } from '../../common/zod.pipe';
const checkoutSchema = z.object({
  listingId: z.string().uuid(),
  requestId: z.string().uuid(),
  locale: z.enum(['zh', 'en']).default('zh'),
});
const subscriptionCheckoutSchema = z.object({
  kind: z.enum(SUBSCRIPTION_KINDS),
  businessId: z.string().uuid().optional(),
  requestId: z.string().uuid(),
  locale: z.enum(['zh', 'en']).default('zh'),
});
const refundSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});
const SUBSCRIPTION_PRICE_ENV: Record<string, string> = {
  business_pro: 'STRIPE_BUSINESS_PRO_PRICE_ID',
  member_plus: 'STRIPE_MEMBER_PLUS_PRICE_ID',
  job_pack: 'STRIPE_JOB_PACK_PRICE_ID',
};
const JOB_PACK_CREDITS = 5;
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(private readonly prisma: PrismaService) {}
  private client() {
    if (
      !process.env.STRIPE_SECRET_KEY ||
      !process.env.STRIPE_WEBHOOK_SECRET ||
      !process.env.STRIPE_PROMOTION_PRICE_ID
    )
      throw new ServiceUnavailableException('Payments are not configured');
    return new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  @Get('product')
  async product() {
    if (
      !process.env.STRIPE_SECRET_KEY ||
      !process.env.STRIPE_WEBHOOK_SECRET ||
      !process.env.STRIPE_PROMOTION_PRICE_ID
    )
      return { available: false };
    const price = await this.client().prices.retrieve(process.env.STRIPE_PROMOTION_PRICE_ID);
    if (
      !price.active ||
      price.type !== 'one_time' ||
      price.currency !== 'aud' ||
      !price.unit_amount
    )
      return { available: false };
    return { available: true, amountMinor: price.unit_amount, currency: price.currency, days: 7 };
  }
  @Post('checkout')
  @UseGuards(AuthGuard)
  async checkout(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(checkoutSchema)) input: z.infer<typeof checkoutSchema>,
  ) {
    const stripe = this.client();
    const listing = await this.prisma.listing.findUnique({ where: { id: input.listingId } });
    if (!listing || listing.ownerId !== user.sub) throw new NotFoundException();
    if (!isPubliclyVisible(listing.status, listing.expiresAt))
      throw new ConflictException('Only current public listings can be promoted');
    const product = await this.product();
    if (!product.available || !product.amountMinor) throw new ServiceUnavailableException();
    const payment = await this.prisma.payment.upsert({
      where: { id: input.requestId },
      update: {},
      create: {
        id: input.requestId,
        ownerId: user.sub,
        listingId: listing.id,
        amountMinor: product.amountMinor,
        currency: 'aud',
      },
    });
    if (
      payment.ownerId !== user.sub ||
      payment.listingId !== listing.id ||
      payment.status !== 'pending'
    )
      throw new ConflictException('Payment request cannot be reused');
    if (payment.sessionId) {
      const old = await stripe.checkout.sessions.retrieve(payment.sessionId);
      if (old.status !== 'open' || !old.url)
        throw new ConflictException('Checkout expired; start a new request');
      return { url: old.url };
    }
    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: payment.currency,
              unit_amount: payment.amountMinor,
              product_data: { name: 'AUCN Hub: 7-day listing highlight' },
            },
            quantity: 1,
          },
        ],
        client_reference_id: payment.id,
        metadata: { paymentId: payment.id },
        payment_intent_data: { metadata: { paymentId: payment.id } },
        success_url: `${origin}/${input.locale}/billing?result=success`,
        cancel_url: `${origin}/${input.locale}/billing?result=cancelled`,
      },
      { idempotencyKey: payment.id },
    );
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { sessionId: session.id },
    });
    return { url: session.url };
  }
  @Get('payments')
  @UseGuards(AuthGuard)
  async payments(@CurrentUser() user: AccessTokenPayload) {
    return this.prisma.payment.findMany({
      where: { ownerId: user.sub },
      select: {
        id: true,
        kind: true,
        status: true,
        amountMinor: true,
        currency: true,
        createdAt: true,
        listing: { select: { title: true } },
        invoice: { select: { number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---------- Subscriptions & packages (§9.1) ----------

  @Post('subscription/checkout')
  @UseGuards(AuthGuard)
  async subscriptionCheckout(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(subscriptionCheckoutSchema))
    input: z.infer<typeof subscriptionCheckoutSchema>,
  ) {
    const stripe = this.client();
    const priceEnv = SUBSCRIPTION_PRICE_ENV[input.kind];
    const priceId = process.env[priceEnv];
    if (!priceId) throw new ServiceUnavailableException('Subscription not configured');
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.currency !== 'aud' || !price.unit_amount)
      throw new ServiceUnavailableException('Subscription price invalid');
    if (input.kind === 'business_pro') {
      if (!input.businessId) throw new BadRequestException('businessId required');
      const b = await this.prisma.business.findUnique({ where: { id: input.businessId } });
      if (!b || (b.claimedById !== user.sub && !['admin', 'super_admin'].includes(user.role)))
        throw new ForbiddenException('Only the business owner can subscribe');
      const existing = await this.prisma.subscription.findFirst({
        where: { businessId: input.businessId, kind: 'business_pro', status: 'active' },
      });
      if (existing) throw new ConflictException('Already subscribed');
    }
    const isRecurring = input.kind !== 'job_pack';
    const payment = await this.prisma.payment.upsert({
      where: { id: input.requestId },
      update: {},
      create: {
        id: input.requestId,
        ownerId: user.sub,
        kind: input.kind === 'job_pack' ? 'job_pack' : 'subscription',
        businessId: input.businessId,
        amountMinor: price.unit_amount,
        currency: 'aud',
      },
    });
    if (payment.ownerId !== user.sub || payment.status !== 'pending')
      throw new ConflictException('Payment request cannot be reused');
    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create(
      {
        mode: isRecurring ? 'subscription' : 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: payment.id,
        metadata: { paymentId: payment.id, kind: input.kind, businessId: input.businessId ?? '' },
        subscription_data: isRecurring
          ? {
              metadata: {
                paymentId: payment.id,
                kind: input.kind,
                businessId: input.businessId ?? '',
              },
            }
          : undefined,
        success_url: `${origin}/${input.locale}/billing?result=success`,
        cancel_url: `${origin}/${input.locale}/billing?result=cancelled`,
      },
      { idempotencyKey: payment.id },
    );
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { sessionId: session.id },
    });
    return { url: session.url };
  }

  @Get('subscriptions')
  @UseGuards(AuthGuard)
  async subscriptions(@CurrentUser() user: AccessTokenPayload) {
    return {
      items: await this.prisma.subscription.findMany({
        where: { ownerId: user.sub },
        orderBy: { createdAt: 'desc' },
      }),
    };
  }

  @Post('subscriptions/:id/cancel')
  @UseGuards(AuthGuard)
  async cancelSubscription(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.ownerId !== user.sub) throw new NotFoundException();
    if (sub.status !== 'active') return { status: sub.status };
    if (sub.stripeSubscriptionId) {
      await this.client().subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }
    await this.prisma.subscription.update({
      where: { id },
      data: { cancelAtPeriodEnd: true },
    });
    return { ok: true };
  }

  // ---------- Ad campaigns (§9.1 原生广告) ----------

  @Post('campaigns')
  @UseGuards(AuthGuard)
  async createCampaign(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(adCampaignSchema)) body: z.infer<typeof adCampaignSchema>,
  ) {
    const campaign = await this.prisma.adCampaign.create({
      data: {
        ...body,
        ownerId: user.sub,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
      },
    });
    return campaign;
  }

  @Get('campaigns')
  @UseGuards(AuthGuard)
  async campaigns(@CurrentUser() user: AccessTokenPayload) {
    return {
      items: await this.prisma.adCampaign.findMany({
        where: { ownerId: user.sub },
        orderBy: { createdAt: 'desc' },
      }),
    };
  }

  @Patch('campaigns/:id')
  @UseGuards(AuthGuard)
  async updateCampaign(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ status: z.enum(['paused', 'active', 'ended']) })))
    body: { status: string },
  ) {
    const campaign = await this.prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign || campaign.ownerId !== user.sub) throw new NotFoundException();
    return this.prisma.adCampaign.update({ where: { id }, data: { status: body.status } });
  }

  /** Pay for a draft campaign; the webhook flips it to active. */
  @Post('campaigns/:id/checkout')
  @UseGuards(AuthGuard)
  async campaignCheckout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z.object({ requestId: z.string().uuid(), locale: z.enum(['zh', 'en']).default('zh') }),
      ),
    )
    input: { requestId: string; locale: string },
  ) {
    const campaign = await this.prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign || campaign.ownerId !== user.sub) throw new NotFoundException();
    if (campaign.status !== 'draft') throw new ConflictException('Campaign already funded');
    const stripe = this.client();
    const payment = await this.prisma.payment.upsert({
      where: { id: input.requestId },
      update: {},
      create: {
        id: input.requestId,
        ownerId: user.sub,
        kind: 'ad',
        adCampaignId: campaign.id,
        amountMinor: campaign.budgetMinor,
        currency: 'aud',
      },
    });
    if (payment.ownerId !== user.sub || payment.status !== 'pending')
      throw new ConflictException('Payment request cannot be reused');
    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'aud',
              unit_amount: campaign.budgetMinor,
              product_data: { name: `AUCN Hub ad campaign: ${campaign.name}` },
            },
            quantity: 1,
          },
        ],
        client_reference_id: payment.id,
        metadata: { paymentId: payment.id, kind: 'ad' },
        payment_intent_data: { metadata: { paymentId: payment.id } },
        success_url: `${origin}/${input.locale}/billing?result=success`,
        cancel_url: `${origin}/${input.locale}/billing?result=cancelled`,
      },
      { idempotencyKey: payment.id },
    );
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { sessionId: session.id },
    });
    return { url: session.url };
  }

  /** Admin: payments + invoices CSV for reconciliation (§5.12 商业/对账). */
  @Get('admin/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @UseGuards(AuthGuard)
  async exportPayments(
    @CurrentUser() user: AccessTokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!['admin', 'super_admin', 'compliance'].includes(user.role)) throw new ForbiddenException();
    const rows = await this.prisma.payment.findMany({
      where: {
        createdAt: {
          gte: from ? new Date(from) : new Date(0),
          lte: to ? new Date(to) : new Date(),
        },
      },
      include: { invoice: { select: { number: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    await this.prisma.auditLog.create({
      data: { actorId: user.sub, action: 'billing.export', subject: 'payments' },
    });
    const esc = (v: string | null | undefined) => `"${(v ?? '').replaceAll('"', '""')}"`;
    return [
      'payment_id,kind,status,amount_minor,currency,invoice_number,invoice_status,created_at',
      ...rows.map((p) =>
        [
          p.id,
          p.kind,
          p.status,
          String(p.amountMinor),
          p.currency,
          esc(p.invoice?.number),
          esc(p.invoice?.status),
          p.createdAt.toISOString(),
        ].join(','),
      ),
    ].join('\n');
  }
  @Post('refund')
  @UseGuards(AuthGuard)
  async refund(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodPipe(refundSchema)) input: z.infer<typeof refundSchema>,
  ) {
    if (!['admin', 'super_admin'].includes(user.role)) throw new ForbiddenException();
    const payment = await this.prisma.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment || !payment.sessionId || payment.status !== 'paid')
      throw new ConflictException('No refundable payment');
    const stripe = this.client();
    const session = await stripe.checkout.sessions.retrieve(payment.sessionId);
    if (typeof session.payment_intent !== 'string')
      throw new ConflictException('Payment intent unavailable');
    await stripe.refunds.create(
      { payment_intent: session.payment_intent },
      { idempotencyKey: `refund:${payment.id}` },
    );
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action: 'payment.refund_requested',
        subject: `payment:${payment.id}`,
        reason: input.reason,
      },
    });
    return { requested: true };
  }
  @Post('webhook')
  @SkipThrottle()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const stripe = this.client();
    let event: Stripe.Event;
    try {
      if (!req.rawBody || !signature) throw new Error();
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentEvent.create({ data: { id: event.id } });
        if (
          event.type === 'checkout.session.completed' ||
          event.type === 'checkout.session.async_payment_succeeded'
        ) {
          const session = event.data.object;
          if (session.payment_status !== 'paid') return;
          const id = session.metadata?.paymentId;
          if (!id) return;
          const payment = await tx.payment.findUnique({ where: { id } });
          if (
            !payment ||
            (payment.sessionId && payment.sessionId !== session.id) ||
            payment.amountMinor !== session.amount_total ||
            payment.currency !== session.currency
          )
            throw new BadRequestException('Payment mismatch');
          const result = await tx.payment.updateMany({
            where: { id, status: 'pending' },
            data: { status: 'paid', sessionId: session.id },
          });
          if (result.count) {
            if (payment.kind === 'promotion' && payment.listingId) {
              await tx.$queryRaw`SELECT id FROM listings WHERE id = ${payment.listingId}::uuid FOR UPDATE`;
              const listing = await tx.listing.findUnique({ where: { id: payment.listingId } });
              if (!listing) throw new NotFoundException();
              const until = new Date(
                Math.max(Date.now(), listing.promotedUntil?.getTime() ?? 0) + 7 * 86400000,
              );
              await tx.listing.update({
                where: { id: listing.id },
                data: { promotedUntil: until, version: { increment: 1 } },
              });
            } else if (payment.kind === 'subscription' || payment.kind === 'job_pack') {
              const stripeSubId =
                typeof session.subscription === 'string' ? session.subscription : null;
              await tx.subscription.create({
                data: {
                  ownerId: payment.ownerId,
                  kind: session.metadata?.kind ?? 'member_plus',
                  businessId: session.metadata?.businessId || payment.businessId,
                  stripeSubscriptionId: stripeSubId,
                  credits: payment.kind === 'job_pack' ? JOB_PACK_CREDITS : 0,
                  status: 'active',
                },
              });
            } else if (payment.kind === 'ad' && payment.adCampaignId) {
              await tx.adCampaign.updateMany({
                where: { id: payment.adCampaignId, status: 'draft' },
                data: { status: 'active' },
              });
            }
            // Every paid payment gets an invoice record (§9 发票).
            const invoiceNo = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}-${payment.id.slice(0, 6).toUpperCase()}`;
            await tx.invoice.upsert({
              where: { paymentId: payment.id },
              update: {},
              create: {
                paymentId: payment.id,
                ownerId: payment.ownerId,
                number: invoiceNo,
                amountMinor: payment.amountMinor,
                currency: payment.currency,
              },
            });
            await tx.notification.create({
              data: { userId: payment.ownerId, kind: 'payment.paid', subjectId: id },
            });
            await tx.auditLog.create({
              data: {
                action: 'payment.fulfilled',
                subject: `payment:${id}`,
                metadata: { eventId: event.id },
              },
            });
          }
        } else if (event.type === 'checkout.session.expired') {
          await tx.payment.updateMany({
            where: { sessionId: event.data.object.id, status: 'pending' },
            data: { status: 'expired' },
          });
        } else if (event.type === 'charge.refunded') {
          const charge = event.data.object;
          if (!charge.refunded) return;
          const id = charge.metadata.paymentId;
          if (!id) return;
          const payment = await tx.payment.findUnique({ where: { id } });
          if (!payment) return;
          const changed = await tx.payment.updateMany({
            where: { id, status: { not: 'refunded' } },
            data: { status: 'refunded' },
          });
          if (!changed.count) return;
          if (payment.status === 'paid' && payment.kind === 'promotion' && payment.listingId) {
            await tx.$queryRaw`SELECT id FROM listings WHERE id = ${payment.listingId}::uuid FOR UPDATE`;
            const listing = await tx.listing.findUniqueOrThrow({
              where: { id: payment.listingId },
            });
            const remaining = (listing.promotedUntil?.getTime() ?? 0) - 7 * 86400000;
            await tx.listing.update({
              where: { id: payment.listingId },
              data: {
                promotedUntil: remaining > Date.now() ? new Date(remaining) : null,
                version: { increment: 1 },
              },
            });
          }
          await tx.invoice.updateMany({
            where: { paymentId: id },
            data: { status: 'refunded' },
          });
          await tx.auditLog.create({
            data: {
              action: 'payment.refunded',
              subject: `payment:${id}`,
              metadata: { eventId: event.id },
            },
          });
        }
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return { received: true };
  }
}
