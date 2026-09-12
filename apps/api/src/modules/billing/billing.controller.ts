import {
  Body,
  Controller,
  Get,
  Post,
  Headers,
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
import { isPubliclyVisible } from '@aucn/domain';
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
const refundSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});
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
        status: true,
        amountMinor: true,
        currency: true,
        createdAt: true,
        listing: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
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
          if (payment.status === 'paid') {
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
