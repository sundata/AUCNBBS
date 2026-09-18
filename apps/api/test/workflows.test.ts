import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import sharp from 'sharp';
import { testDatabase, fixture, challenge } from './fixtures';
import { totpCode } from '../src/common/totp';
const prisma = testDatabase();
const origin = process.env.TEST_API_URL ?? 'http://localhost:4100';
const users: Awaited<ReturnType<typeof fixture>>[] = [];
let ownerToken = '',
  buyerToken = '',
  adminToken = '',
  editorToken = '',
  modToken = '',
  cityId = '',
  listingId = '',
  conversationId = '';
let ownerRefresh = '';
const payments: string[] = [];
const events: string[] = [];
async function call(path: string, token = '', method = 'GET', body?: unknown) {
  return fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const input = () => ({
  type: 'item',
  intent: 'offer',
  title: 'Integration desk',
  body: 'An integration test desk for sale.',
  cityId,
  priceMinor: 1234,
  item: { category: 'furniture', condition: 'good', deliveryMethods: ['pickup'], suburb: 'Sydney' },
});
const STAFF_TOTP = 'JBSWY3DPEHPK3PXP';
beforeAll(async () => {
  for (const role of ['member', 'member', 'admin', 'editor', 'moderator'] as const)
    users.push(await fixture(prisma, role));
  // StaffMfaGuard requires staff accounts to have TOTP enrolled; complete the
  // real challenge flow for the shared staff tokens.
  await prisma.user.updateMany({
    where: { id: { in: users.slice(2).map((u) => u.id) } },
    data: { totpSecret: STAFF_TOTP, totpEnabledAt: new Date() },
  });
  const tokens = [];
  for (const user of users) {
    const res = await call('/auth/otp/verify', '', 'POST', { email: user.email, code: '123456' });
    expect(res.status).toBe(201);
    let body = await res.json();
    if (body.mfaRequired) {
      const done = await call('/auth/mfa/complete', '', 'POST', {
        ticket: body.ticket,
        code: totpCode(STAFF_TOTP),
      });
      expect(done.status).toBe(201);
      body = await done.json();
    }
    tokens.push(body);
  }
  [ownerToken, buyerToken, adminToken, editorToken, modToken] = tokens.map((t) => t.accessToken);
  ownerRefresh = tokens[0].refreshToken;
  cityId = (
    await prisma.city.create({
      data: {
        slug: `test-${randomUUID()}`,
        state: 'NSW',
        nameZh: '测试城市',
        nameEn: 'Test City',
        timezone: 'Australia/Sydney',
      },
    })
  ).id;
});
afterAll(async () => {
  const ids = users.map((u) => u.id);
  await prisma.paymentEvent.deleteMany({ where: { id: { in: events } } });
  await prisma.invoice.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.adCampaign.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { buyerId: { in: ids } } });
  await prisma.eventRsvp.deleteMany({ where: { userId: { in: ids } } });
  await prisma.event.deleteMany({ where: { organizerId: { in: ids } } });
  await prisma.businessReview.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.businessClaim.deleteMany({ where: { claimantId: { in: ids } } });
  await prisma.business.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.appeal.deleteMany({ where: { appellantId: { in: ids } } });
  await prisma.report.deleteMany({
    where: {
      OR: [{ reporterId: { in: ids } }, { reporterId: null }],
    },
  });
  await prisma.post.updateMany({
    where: { authorId: { in: ids } },
    data: { acceptedCommentId: null },
  });
  await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.comment.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.board.deleteMany({ where: { slug: { startsWith: 'test-' } } });
  await prisma.media.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.listing.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.contentRevision.deleteMany({ where: { editorId: { in: ids } } });
  await prisma.article.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.pushSubscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passkeyCredential.deleteMany({ where: { userId: { in: ids } } });
  await prisma.mfaChallenge.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.appConfig.deleteMany({ where: { key: 'cms' } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorId: { in: ids } }, ...payments.map((id) => ({ subject: `payment:${id}` }))],
    },
  });
  await prisma.otpChallenge.deleteMany({ where: { email: { in: users.map((u) => u.email) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (cityId) await prisma.city.delete({ where: { id: cityId } });
  await prisma.$disconnect();
});
describe.sequential('real database workflows', () => {
  it('routes member listings through the review queue before going live', async () => {
    const created = await call('/listings', ownerToken, 'POST', input());
    expect(created.status).toBe(201);
    const row = await created.json();
    listingId = row.id;
    expect(row.status).toBe('pending_review');
    // Hidden from the public but visible to the owner while under review.
    expect((await call(`/listings/${listingId}`)).status).toBe(404);
    expect((await call(`/listings/${listingId}`, ownerToken)).status).toBe(200);
    // Edits are locked while under review; owners cannot self-approve.
    expect(
      (
        await call(`/listings/${listingId}`, ownerToken, 'PATCH', {
          version: row.version,
          listing: input(),
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(`/listings/${listingId}/status`, ownerToken, 'POST', { status: 'active' }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(`/admin/listings/${listingId}/review`, buyerToken, 'POST', {
          decision: 'approve',
        })
      ).status,
    ).toBe(403);
    // Moderator approval publishes the listing and notifies the owner.
    expect(
      (
        await call(`/admin/listings/${listingId}/review`, adminToken, 'POST', {
          decision: 'approve',
        })
      ).status,
    ).toBe(201);
    expect(
      await prisma.notification.count({
        where: { userId: users[0].id, kind: 'listing.approved', subjectId: listingId },
      }),
    ).toBe(1);
    expect((await call(`/listings/${listingId}`)).status).toBe(200);
  });
  it('creates a listing; denies edits from another account and stale versions', async () => {
    const current = await (await call(`/listings/${listingId}`, ownerToken)).json();
    expect(
      (
        await call(`/listings/${listingId}`, buyerToken, 'PATCH', {
          version: current.version,
          listing: input(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/listings/${listingId}`, ownerToken, 'PATCH', {
          version: current.version,
          listing: { ...input(), title: 'Updated desk' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/listings/${listingId}`, ownerToken, 'PATCH', {
          version: current.version,
          listing: input(),
        })
      ).status,
    ).toBe(409);
  });
  it('isolates conversations, delivers notifications and marks messages read', async () => {
    const start = await call('/messages/conversations', buyerToken, 'POST', { listingId });
    expect(start.status).toBe(201);
    conversationId = (await start.json()).id;
    const again = await call('/messages/conversations', buyerToken, 'POST', { listingId });
    expect((await again.json()).id).toBe(conversationId);
    expect((await call(`/messages/conversations/${conversationId}`, editorToken)).status).toBe(404);
    expect(
      (
        await call(`/messages/conversations/${conversationId}`, buyerToken, 'POST', {
          body: 'Is this still available?',
        })
      ).status,
    ).toBe(201);
    const messages = await (
      await call(`/messages/conversations/${conversationId}`, ownerToken)
    ).json();
    expect(messages.items[0].body).toBe('Is this still available?');
    expect(
      await prisma.notification.count({
        where: { userId: users[0].id, kind: 'message', readAt: null },
      }),
    ).toBe(1);
    await call(`/messages/conversations/${conversationId}/read`, ownerToken, 'POST');
    expect(await prisma.message.count({ where: { conversationId, readAt: null } })).toBe(0);
  });
  it('normalizes uploaded images and blocks other owners', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const upload = async (token: string, bytes: Buffer) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'test.png');
      return fetch(`${origin}/api/v1/media/listings/${listingId}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
    };
    expect((await upload(buyerToken, png)).status).toBe(403);
    expect((await upload(ownerToken, Buffer.from('<svg/>'))).status).toBe(422);
    const res = await upload(ownerToken, png);
    expect(res.status).toBe(201);
    const media = await res.json();
    const downloaded = await call(`/media/${media.id}`);
    expect(downloaded.headers.get('content-type')).toContain('image/webp');
    await call(`/listings/${listingId}/status`, ownerToken, 'POST', { status: 'paused' });
    expect((await call(`/media/${media.id}`)).status).toBe(404);
    expect((await call(`/media/${media.id}`, ownerToken)).status).toBe(200);
    expect((await call(`/media/${media.id}`, ownerToken, 'DELETE')).status).toBe(200);
    await call(`/listings/${listingId}/status`, ownerToken, 'POST', { status: 'active' });
  });
  it('publishes CMS articles with role checks, optimistic locking and audit history', async () => {
    const article = {
      slug: `test-${randomUUID()}`,
      title: 'Integration article',
      summary: 'Integration article summary.',
      body: 'Integration article body.',
      category: 'life',
      locale: 'en',
      source: null,
      status: 'draft',
    };
    expect((await call('/admin/articles', buyerToken, 'POST', article)).status).toBe(403);
    const res = await call('/admin/articles', editorToken, 'POST', article);
    expect(res.status).toBe(201);
    const row = await res.json();
    expect((await call(`/articles/${row.slug}`)).status).toBe(404);
    expect(
      (
        await call(`/admin/articles/${row.id}`, editorToken, 'PATCH', {
          ...article,
          status: 'published',
          updatedAt: row.updatedAt,
        })
      ).status,
    ).toBe(200);
    expect((await call(`/articles/${row.slug}`)).status).toBe(200);
    expect(
      (
        await call(`/admin/articles/${row.id}`, editorToken, 'PATCH', {
          ...article,
          updatedAt: row.updatedAt,
        })
      ).status,
    ).toBe(409);
    expect(await prisma.auditLog.count({ where: { subject: `article:${row.id}` } })).toBe(2);
  });
  it('paginates owner listings without omissions', async () => {
    await prisma.listing.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        ownerId: users[0].id,
        type: 'item' as const,
        title: `Page ${i}`,
        body: 'Test listing body',
        cityId,
        status: 'active' as const,
        expiresAt: new Date(Date.now() + 86400000),
      })),
    });
    const first = await (await call('/listings/mine?limit=20', ownerToken)).json();
    expect(first.items.length).toBe(20);
    const second = await (
      await call(`/listings/mine?limit=20&cursor=${first.nextCursor}`, ownerToken)
    ).json();
    expect(new Set([...first.items, ...second.items].map((r: { id: string }) => r.id)).size).toBe(
      23,
    );
  });
  it('renews time-expired listings before the worker runs', async () => {
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: 'active', expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await call(`/listings/${listingId}`)).status).toBe(404);
    const res = await call(`/listings/${listingId}/status`, ownerToken, 'POST', {
      status: 'active',
    });
    expect(res.status).toBe(201);
    expect(new Date((await res.json()).expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
  it('fulfills only signed, matching paid events and ignores retries', async () => {
    const id = randomUUID();
    payments.push(id);
    await prisma.payment.create({
      data: { id, ownerId: users[0].id, listingId, amountMinor: 990, currency: 'aud' },
    });
    const stripe = new Stripe('sk_test_fixture');
    const eventId = `evt_${randomUUID()}`;
    events.push(eventId);
    const payload = JSON.stringify({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${id}`,
          metadata: { paymentId: id },
          payment_status: 'paid',
          amount_total: 990,
          currency: 'aud',
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_integration_fixture',
    });
    const send = (sig: string) =>
      fetch(`${origin}/api/v1/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': sig },
        body: payload,
      });
    expect((await send('invalid')).status).toBe(400);
    expect((await send(signature)).status).toBe(201);
    const until = (await prisma.listing.findUniqueOrThrow({ where: { id: listingId } }))
      .promotedUntil;
    expect(until).not.toBeNull();
    expect((await send(signature)).status).toBe(201);
    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).promotedUntil,
    ).toEqual(until);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).status).toBe('paid');
  });
  it('rejects payment amount mismatch and processes full refunds once', async () => {
    const stripe = new Stripe('sk_test_fixture');
    const send = async (event: object) => {
      const payload = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: 'whsec_integration_fixture',
      });
      return fetch(`${origin}/api/v1/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        body: payload,
      });
    };
    const id = randomUUID();
    payments.push(id);
    await prisma.payment.create({
      data: { id, ownerId: users[0].id, listingId, amountMinor: 990, currency: 'aud' },
    });
    const wrongId = `evt_${randomUUID()}`;
    events.push(wrongId);
    expect(
      (
        await send({
          id: wrongId,
          type: 'checkout.session.completed',
          data: {
            object: {
              id: `cs_${id}`,
              metadata: { paymentId: id },
              payment_status: 'paid',
              amount_total: 1,
              currency: 'aud',
            },
          },
        })
      ).status,
    ).toBe(400);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
    const paidId = payments[0];
    const refundEvent = `evt_${randomUUID()}`;
    events.push(refundEvent);
    const event = {
      id: refundEvent,
      type: 'charge.refunded',
      data: { object: { refunded: true, metadata: { paymentId: paidId } } },
    };
    expect((await send(event)).status).toBe(201);
    expect((await send(event)).status).toBe(201);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paidId } })).status).toBe(
      'refunded',
    );
    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).promotedUntil,
    ).toBeNull();
  });

  it('rejects unconfigured OAuth and mismatched browser state before provider calls', async () => {
    expect((await call('/auth/providers')).status).toBe(200);
    expect(
      (
        await call('/auth/oauth/start', '', 'POST', {
          provider: 'google',
          locale: 'en',
          binding: 'a'.repeat(64),
        })
      ).status,
    ).toBe(503);
    const id = 'a'.repeat(43);
    await prisma.oAuthAttempt.create({
      data: {
        id,
        provider: 'google',
        verifier: 'pkce.invalid-binding',
        nonce: 'nonce',
        locale: 'en',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    try {
      expect(
        (
          await call('/auth/oauth/complete', '', 'POST', {
            state: id,
            code: 'test-code',
            binding: 'b'.repeat(64),
          })
        ).status,
      ).toBe(401);
      expect(await prisma.oAuthAttempt.count({ where: { id } })).toBe(1);
    } finally {
      await prisma.oAuthAttempt.deleteMany({ where: { id } });
    }
  });

  it('resolves reports atomically and removes public content', async () => {
    const res = await call('/reports', buyerToken, 'POST', {
      subjectType: 'listing',
      subjectId: listingId,
      reason: 'other',
    });
    expect(res.status).toBe(201);
    const report = await prisma.report.findFirstOrThrow({ where: { subjectId: listingId } });
    const decision = {
      status: 'actioned',
      reason: 'Confirmed policy violation',
      updatedAt: report.updatedAt.toISOString(),
    };
    expect((await call(`/admin/reports/${report.id}`, ownerToken, 'PATCH', decision)).status).toBe(
      403,
    );
    expect((await call(`/admin/reports/${report.id}`, adminToken, 'PATCH', decision)).status).toBe(
      200,
    );
    expect((await call(`/admin/reports/${report.id}`, adminToken, 'PATCH', decision)).status).toBe(
      409,
    );
    expect((await call(`/listings/${listingId}`)).status).toBe(404);
    expect(
      (await call(`/listings/${listingId}/status`, ownerToken, 'POST', { status: 'active' }))
        .status,
    ).toBe(422);
  });
  it('rejects a listing, lets the owner appeal, and requires a second reviewer', async () => {
    const created = await call('/listings', buyerToken, 'POST', {
      ...input(),
      title: 'Appealed desk',
    });
    const row = await created.json();
    expect(row.status).toBe('pending_review');
    // Members cannot bypass review while under moderation.
    expect(
      (await call(`/listings/${row.id}/status`, buyerToken, 'POST', { status: 'active' })).status,
    ).toBe(403);
    // Rejection requires a reason and notifies the owner.
    expect(
      (await call(`/admin/listings/${row.id}/review`, adminToken, 'POST', { decision: 'reject' }))
        .status,
    ).toBe(422);
    expect(
      (
        await call(`/admin/listings/${row.id}/review`, adminToken, 'POST', {
          decision: 'reject',
          reason: 'Missing required details',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await prisma.listing.findUniqueOrThrow({
          where: { id: row.id },
          select: { status: true, reviewedById: true },
        })
      ).status,
    ).toBe('rejected');
    // The owner appeals while the listing is rejected; the original reviewer cannot decide it.
    const appeal = await call('/appeals', buyerToken, 'POST', {
      subjectType: 'listing',
      subjectId: row.id,
      reason: 'The listing is compliant and was fixed.',
    });
    expect(appeal.status).toBe(201);
    const appealId = (await appeal.json()).id;
    expect(
      (
        await call('/appeals', buyerToken, 'POST', {
          subjectType: 'listing',
          subjectId: row.id,
          reason: 'Duplicate appeal should be rejected.',
        })
      ).status,
    ).toBe(409);
    const decision = { decision: 'overturned', note: 'Reviewed again: compliant.' };
    expect((await call(`/admin/appeals/${appealId}`, adminToken, 'PATCH', decision)).status).toBe(
      403,
    );
    expect((await call(`/admin/appeals/${appealId}`, modToken, 'PATCH', decision)).status).toBe(
      200,
    );
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'active',
    );
    expect((await call(`/admin/appeals/${appealId}`, modToken, 'PATCH', decision)).status).toBe(
      409,
    );
    await prisma.listing.delete({ where: { id: row.id } });
    // Editing a rejected listing parks it back in draft; resubmit re-queues it.
    const second = await call('/listings', buyerToken, 'POST', {
      ...input(),
      title: 'Resubmitted desk',
    });
    const secondId = (await second.json()).id;
    await call(`/admin/listings/${secondId}/review`, adminToken, 'POST', {
      decision: 'reject',
      reason: 'Needs better photos',
    });
    const rejected = await (await call(`/listings/${secondId}`, buyerToken)).json();
    expect(rejected.status).toBe('rejected');
    expect(rejected.reviewNote).toBe('Needs better photos');
    expect(
      (
        await call(`/listings/${secondId}`, buyerToken, 'PATCH', {
          version: rejected.version,
          listing: { ...input(), title: 'Resubmitted desk v2' },
        })
      ).status,
    ).toBe(200);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: secondId } })).status).toBe(
      'draft',
    );
    expect(
      (
        await call(`/listings/${secondId}/status`, buyerToken, 'POST', {
          status: 'pending_review',
        })
      ).status,
    ).toBe(201);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: secondId } })).status).toBe(
      'pending_review',
    );
    await prisma.listing.delete({ where: { id: secondId } });
  });

  it('manages favorites, follows and saved searches', async () => {
    // Favorite an active listing (admins are trusted, so it skips review).
    const fresh = await call('/listings', adminToken, 'POST', {
      ...input(),
      title: 'Favorite target',
    });
    const freshId = (await fresh.json()).id;
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: freshId } })).status).toBe(
      'active',
    );
    expect(
      (
        await call('/me/favorites', buyerToken, 'POST', {
          subjectType: 'listing',
          subjectId: freshId,
        })
      ).status,
    ).toBe(201);
    // Adding the same favorite again is idempotent.
    expect(
      (
        await call('/me/favorites', buyerToken, 'POST', {
          subjectType: 'listing',
          subjectId: freshId,
        })
      ).status,
    ).toBe(201);
    const state = await (await call(`/me/favorites/listing/${freshId}`, buyerToken)).json();
    expect(state.favorited).toBe(true);
    const favs = await (await call('/me/favorites', buyerToken)).json();
    expect(favs.items.some((f: { subjectId: string }) => f.subjectId === freshId)).toBe(true);
    expect((await call(`/me/favorites/listing/${freshId}`, buyerToken, 'DELETE')).status).toBe(200);
    await prisma.listing.delete({ where: { id: freshId } });
    // Follows: no self-follow, idempotent add, idempotent remove.
    expect(
      (
        await call('/me/follows', buyerToken, 'POST', {
          subjectType: 'user',
          subjectId: users[1].id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('/me/follows', buyerToken, 'POST', {
          subjectType: 'user',
          subjectId: users[0].id,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call('/me/follows', buyerToken, 'POST', {
          subjectType: 'user',
          subjectId: users[0].id,
        })
      ).status,
    ).toBe(201);
    expect((await call(`/me/follows/user/${users[0].id}`, buyerToken, 'DELETE')).status).toBe(200);
    // Saved searches are private to the owner.
    const saved = await call('/me/saved-searches', buyerToken, 'POST', {
      name: 'Sydney desks',
      query: 'desk',
      cadence: 'daily',
    });
    expect(saved.status).toBe(201);
    const savedId = (await saved.json()).id;
    const list = await (await call('/me/saved-searches', buyerToken)).json();
    expect(list.items.length).toBe(1);
    expect((await call(`/me/saved-searches/${savedId}`, ownerToken, 'DELETE')).status).toBe(404);
    expect((await call(`/me/saved-searches/${savedId}`, buyerToken, 'DELETE')).status).toBe(200);
  });

  it('lists devices and revokes another session remotely', async () => {
    await challenge(prisma, users[1].email);
    const second = await call('/auth/otp/verify', '', 'POST', {
      email: users[1].email,
      code: '123456',
    });
    const secondToken = (await second.json()).accessToken;
    const sessions = await (await call('/me/sessions', secondToken)).json();
    expect(sessions.items.length).toBeGreaterThanOrEqual(2);
    const current = sessions.items.find((s: { current: boolean }) => s.current);
    const other = sessions.items.find((s: { current: boolean }) => !s.current);
    expect(current).toBeTruthy();
    expect((await call(`/me/sessions/${current.id}`, secondToken, 'DELETE')).status).toBe(403);
    expect((await call(`/me/sessions/${other.id}`, secondToken, 'DELETE')).status).toBe(200);
    expect((await call('/me', buyerToken)).status).toBe(401);
    buyerToken = secondToken;
  });

  it('exports personal data without secrets and toggles deletion', async () => {
    const res = await call('/me/export', buyerToken);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile.id).toBe(users[1].id);
    expect(JSON.stringify(data)).not.toContain('tokenFamilyHash');
    expect(JSON.stringify(data)).not.toContain('codeHash');
    const del = await call('/me/deletion', buyerToken, 'POST');
    expect(del.status).toBe(201);
    // The account stays usable during the grace period so the user can cancel.
    expect((await call('/me', buyerToken)).status).toBe(200);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: users[1].id },
          select: { deletionRequestedAt: true },
        })
      ).deletionRequestedAt,
    ).not.toBeNull();
    expect((await call('/me/deletion', buyerToken, 'DELETE')).status).toBe(200);
    expect((await call('/me', buyerToken)).status).toBe(200);
  });

  it('runs the business directory with claiming and reviews', async () => {
    const create = await call('/businesses', ownerToken, 'POST', {
      nameZh: '测试餐厅',
      nameEn: 'Test Restaurant',
      category: 'restaurant',
      descriptionZh: '一家测试餐厅，菜品丰富。',
      suburb: 'Haymarket',
      cityId,
    });
    expect(create.status).toBe(201);
    const business = await create.json();
    expect((await call(`/businesses/${business.id}`)).status).toBe(200);
    const review = await call(`/businesses/${business.id}/reviews`, buyerToken, 'POST', {
      rating: 5,
      body: 'Great food and friendly service.',
    });
    expect(review.status).toBe(201);
    expect(
      (
        await call(`/businesses/${business.id}/reviews`, buyerToken, 'POST', {
          rating: 4,
          body: 'Second review should conflict.',
        })
      ).status,
    ).toBe(409);
    const claim = await call(`/businesses/${business.id}/claim`, buyerToken, 'POST', {
      evidence: 'I am the owner; ABN and phone records attached.',
    });
    expect(claim.status).toBe(201);
    expect(
      (
        await call(`/businesses/${business.id}/claim`, buyerToken, 'POST', {
          evidence: 'x'.repeat(20),
        })
      ).status,
    ).toBe(409);
    const claimRow = await prisma.businessClaim.findFirstOrThrow({
      where: { businessId: business.id },
    });
    expect(
      (
        await call(`/admin/business-claims/${claimRow.id}`, adminToken, 'PATCH', {
          decision: 'approved',
        })
      ).status,
    ).toBe(200);
    expect(
      (await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).claimedById,
    ).toBe(users[1].id);
    const claimed = await (await call(`/businesses/${business.id}`, buyerToken)).json();
    expect(claimed.viewerIsOwner).toBe(true);
    expect(
      (
        await call(
          `/businesses/${business.id}/reviews/${(await review.json()).id}/reply`,
          buyerToken,
          'POST',
          { reply: 'Thank you!' },
        )
      ).status,
    ).toBe(201);
  });

  it('runs events with RSVP, capacity waitlist and ICS export', async () => {
    const startsAt = new Date(Date.now() + 86400000).toISOString();
    const endsAt = new Date(Date.now() + 90000000).toISOString();
    const create = await call('/events', ownerToken, 'POST', {
      title: 'Test meetup',
      body: 'A test meetup for integration.',
      category: 'community',
      cityId,
      venue: 'Community hall',
      startsAt,
      endsAt,
      capacity: 1,
    });
    expect(create.status).toBe(201);
    const event = await create.json();
    expect((await call(`/events/${event.id}`)).status).toBe(200);
    const rsvp = await call(`/events/${event.id}/rsvp`, buyerToken, 'POST');
    expect(rsvp.status).toBe(201);
    expect((await rsvp.json()).status).toBe('going');
    // Idempotent re-register.
    expect((await call(`/events/${event.id}/rsvp`, buyerToken, 'POST')).status).toBe(201);
    // Capacity 1 → the next attendee lands on the waitlist.
    const waitlist = await call(`/events/${event.id}/rsvp`, modToken, 'POST');
    expect((await waitlist.json()).status).toBe('waitlist');
    // Cancelling promotes the waitlisted attendee and notifies them.
    expect((await call(`/events/${event.id}/rsvp`, buyerToken, 'DELETE')).status).toBe(200);
    expect(
      await prisma.notification.count({
        where: { userId: users[4].id, kind: 'event.promoted', subjectId: event.id },
      }),
    ).toBe(1);
    const ics = await call(`/events/${event.id}/ics`);
    expect(ics.headers.get('content-type')).toContain('text/calendar');
    expect(await ics.text()).toContain('BEGIN:VEVENT');
  });

  it('makes codes single-use and applies role changes and logout immediately', async () => {
    await challenge(prisma, users[0].email);
    const a = await call('/auth/otp/verify', '', 'POST', { email: users[0].email, code: '123456' });
    expect(a.status).toBe(201);
    expect(
      (await call('/auth/otp/verify', '', 'POST', { email: users[0].email, code: '123456' }))
        .status,
    ).toBe(401);
    await prisma.user.update({ where: { id: users[2].id }, data: { role: 'member' } });
    expect((await call('/admin/reports', adminToken)).status).toBe(403);
    await call('/auth/logout', '', 'POST', { refreshToken: ownerRefresh });
    expect((await call('/me', ownerToken)).status).toBe(401);
    await prisma.user.update({ where: { id: users[1].id }, data: { status: 'banned' } });
    expect((await call('/me', buyerToken)).status).toBe(401);
  });

  async function freshMember() {
    const u = await fixture(prisma, 'member');
    users.push(u);
    await challenge(prisma, u.email);
    const res = await call('/auth/otp/verify', '', 'POST', { email: u.email, code: '123456' });
    expect(res.status).toBe(201);
    return { user: u, token: (await res.json()).accessToken as string };
  }

  it('enforces TOTP MFA end-to-end for staff accounts', async () => {
    const staff = await fixture(prisma, 'moderator');
    users.push(staff);
    await challenge(prisma, staff.email);
    const first = await (
      await call('/auth/otp/verify', '', 'POST', { email: staff.email, code: '123456' })
    ).json();
    expect(first.mfaSetupRequired).toBe(true);
    const setup = await (await call('/auth/mfa/setup', first.accessToken, 'POST')).json();
    expect(setup.secret).toBeTruthy();
    expect(setup.uri).toContain('otpauth://totp/');
    expect(
      (await call('/auth/mfa/enable', first.accessToken, 'POST', { code: '000000' })).status,
    ).toBe(401);
    expect(
      (
        await call('/auth/mfa/enable', first.accessToken, 'POST', {
          code: totpCode(setup.secret),
        })
      ).status,
    ).toBe(201);
    // The next sign-in stops at the MFA challenge instead of issuing tokens.
    await challenge(prisma, staff.email);
    const second = await (
      await call('/auth/otp/verify', '', 'POST', { email: staff.email, code: '123456' })
    ).json();
    expect(second.mfaRequired).toBe(true);
    expect(second.accessToken).toBeUndefined();
    // A wrong code burns the ticket; a fresh challenge is needed.
    expect(
      (await call('/auth/mfa/complete', '', 'POST', { ticket: second.ticket, code: '000000' }))
        .status,
    ).toBe(401);
    await challenge(prisma, staff.email);
    const third = await (
      await call('/auth/otp/verify', '', 'POST', { email: staff.email, code: '123456' })
    ).json();
    const done = await (
      await call('/auth/mfa/complete', '', 'POST', {
        ticket: third.ticket,
        code: totpCode(setup.secret),
      })
    ).json();
    expect(done.accessToken).toBeTruthy();
    expect((await call('/me', done.accessToken)).status).toBe(200);
    // Staff roles cannot disable MFA.
    expect(
      (
        await call('/auth/mfa/disable', done.accessToken, 'POST', {
          code: totpCode(setup.secret),
        })
      ).status,
    ).toBe(403);
  });

  it('runs polls, accepted answers, edit history and moderation tools', async () => {
    const author = await freshMember();
    const voter = await freshMember();
    const board = await prisma.board.create({
      data: { slug: `test-${randomUUID()}`, nameZh: '测试版', nameEn: 'Test Board' },
    });
    const pollPost = await (
      await call('/community/posts', author.token, 'POST', {
        boardSlug: board.slug,
        type: 'poll',
        title: 'Best day for meetup?',
        body: 'Vote for the best day of the week.',
        poll: { options: ['Saturday', 'Sunday'] },
      })
    ).json();
    expect(pollPost.id).toBeTruthy();
    const detail = await (await call(`/community/posts/${pollPost.id}`)).json();
    expect(detail.poll.options).toHaveLength(2);
    const optionId = detail.poll.options[0].id;
    const voted = await (
      await call(`/community/posts/${pollPost.id}/vote`, voter.token, 'POST', {
        optionIds: [optionId],
      })
    ).json();
    expect(voted.options.find((o: { id: string }) => o.id === optionId).votes).toBe(1);
    // Question post: comment → author accepts it as the answer.
    const question = await (
      await call('/community/posts', author.token, 'POST', {
        boardSlug: board.slug,
        type: 'question',
        title: 'How to transfer money?',
        body: 'What is the cheapest way to transfer AUD to CNY?',
      })
    ).json();
    const comment = await (
      await call(`/community/posts/${question.id}/comments`, voter.token, 'POST', {
        body: 'Use a specialist transfer service.',
      })
    ).json();
    expect(
      (
        await call(`/community/posts/${question.id}/accept`, author.token, 'POST', {
          commentId: comment.id,
        })
      ).status,
    ).toBe(201);
    // Editing records a revision visible to the author.
    expect(
      (
        await call(`/community/posts/${question.id}`, author.token, 'PATCH', {
          body: 'What is the cheapest way to transfer AUD to CNY? Also interested in fees.',
        })
      ).status,
    ).toBe(200);
    const revisions = await (
      await call(`/community/posts/${question.id}/revisions`, author.token)
    ).json();
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    // Moderators can pin and lock; locked posts reject new comments.
    const mod = await fixture(prisma, 'moderator');
    users.push(mod);
    await prisma.user.update({
      where: { id: mod.id },
      data: { totpSecret: STAFF_TOTP, totpEnabledAt: new Date() },
    });
    await challenge(prisma, mod.email);
    const modAuth = await (
      await call('/auth/otp/verify', '', 'POST', { email: mod.email, code: '123456' })
    ).json();
    const modDone = await (
      await call('/auth/mfa/complete', '', 'POST', {
        ticket: modAuth.ticket,
        code: totpCode(STAFF_TOTP),
      })
    ).json();
    modAuth.accessToken = modDone.accessToken;
    expect(
      (
        await call(`/admin/posts/${question.id}/mod`, modAuth.accessToken, 'POST', {
          action: 'lock',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(`/community/posts/${question.id}/comments`, voter.token, 'POST', {
          body: 'This should be blocked.',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/admin/posts/${question.id}/mod`, modAuth.accessToken, 'POST', {
          action: 'pin',
        })
      ).status,
    ).toBe(201);
  });

  it('deduplicates reports and screens listings for risk', async () => {
    const reporter = await freshMember();
    const listing = await prisma.listing.create({
      data: {
        ownerId: reporter.user.id,
        type: 'item',
        intent: 'offer',
        title: 'Reportable listing',
        body: 'A listing to report.',
        status: 'active',
        cityId,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const first = await call('/reports', reporter.token, 'POST', {
      subjectType: 'listing',
      subjectId: listing.id,
      reason: 'spam',
    });
    expect(first.status).toBe(201);
    const dup = await call('/reports', reporter.token, 'POST', {
      subjectType: 'listing',
      subjectId: listing.id,
      reason: 'spam',
    });
    expect(dup.status).toBe(409);
    // Risk screening flags scammy copy on create.
    const flagged = await call('/listings', reporter.token, 'POST', {
      ...input(),
      title: 'Great desk 请先转押金',
      body: '先转账押金再看房，微信私聊详谈。',
    });
    expect(flagged.status).toBe(201);
    const flaggedBody = await flagged.json();
    expect(flaggedBody.status).toBe('pending_review');
    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: flaggedBody.id } })).riskFlags.length,
    ).toBeGreaterThan(0);
  });

  it('handles stranger requests, masking, recall and blocking in messages', async () => {
    const seller = await freshMember();
    const buyer = await freshMember();
    const listing = await prisma.listing.create({
      data: {
        ownerId: seller.user.id,
        type: 'item',
        intent: 'offer',
        title: 'Message test listing',
        body: 'A listing for messaging tests.',
        status: 'active',
        cityId,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const convo = await (
      await call('/messages/conversations', buyer.token, 'POST', { listingId: listing.id })
    ).json();
    expect(convo.status).toBe('requested');
    // Sensitive numbers are masked and external links flagged.
    const sent = await (
      await call(`/messages/conversations/${convo.id}`, buyer.token, 'POST', {
        body: 'My TFN is 123456782, see https://evil.example/pay',
      })
    ).json();
    expect(sent.masked).toBe(true);
    expect(sent.body).not.toContain('123456782');
    expect(sent.hasLink).toBe(true);
    // Seller accepts the request.
    expect(
      (
        await call(`/messages/conversations/${convo.id}/respond`, seller.token, 'POST', {
          accept: true,
        })
      ).status,
    ).toBe(201);
    // Sender can recall a fresh message.
    expect((await call(`/messages/${sent.id}/recall`, buyer.token, 'POST')).status).toBe(201);
    // Blocking stops further messages.
    expect(
      (await call('/messages/blocks', seller.token, 'POST', { userId: buyer.user.id })).status,
    ).toBe(201);
    expect(
      (
        await call(`/messages/conversations/${convo.id}`, buyer.token, 'POST', {
          body: 'Are you there?',
        })
      ).status,
    ).toBe(403);
  });

  it('collects business leads and serves ads with click billing', async () => {
    const owner = await freshMember();
    const visitor = await freshMember();
    const business = await (
      await call('/businesses', owner.token, 'POST', {
        nameZh: '线索餐厅',
        nameEn: 'Lead Restaurant',
        category: 'restaurant',
        suburb: 'CBD',
        cityId,
      })
    ).json();
    // Creator only reads the lead inbox after claiming the business.
    await prisma.business.update({
      where: { id: business.id },
      data: { claimedById: owner.user.id },
    });
    const lead = await call(`/businesses/${business.id}/leads`, visitor.token, 'POST', {
      name: 'Test Visitor',
      contact: 'visitor@example.com',
      message: 'Do you cater for events?',
    });
    expect(lead.status).toBe(201);
    const inbox = await (await call(`/businesses/${business.id}/leads`, owner.token)).json();
    expect(inbox.items.length).toBe(1);
    expect(inbox.items[0].status).toBe('new');
    // Non-owner cannot read the inbox.
    expect((await call(`/businesses/${business.id}/leads`, visitor.token)).status).toBe(403);
    // Active ad campaign serves on the home placement and debits per click.
    const campaign = await prisma.adCampaign.create({
      data: {
        ownerId: owner.user.id,
        name: 'test-campaign',
        title: 'Sponsored listing',
        targetUrl: 'https://example.com/ad',
        placement: 'home',
        status: 'active',
        budgetMinor: 500,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 86400000),
      },
    });
    const served = await (await call('/ads/serve?placement=home')).json();
    expect(served.ad.id).toBe(campaign.id);
    expect(served.ad.sponsored).toBe(true);
    expect((await call(`/ads/${campaign.id}/click`, '', 'POST')).status).toBe(201);
    const after = await prisma.adCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(after.clicks).toBe(1);
    expect(after.spentMinor).toBeGreaterThan(0);
  });
});

describe.sequential('round-4 hardening', () => {
  // The earlier suite deliberately revokes/demotes the shared tokens, so these
  // tests mint their own.
  async function memberLogin() {
    const u = await fixture(prisma, 'member');
    users.push(u);
    const res = await call('/auth/otp/verify', '', 'POST', {
      email: u.email,
      code: '123456',
    });
    return (await res.json()).accessToken as string;
  }
  async function staffLogin(role: 'admin' | 'editor' | 'moderator') {
    const u = await fixture(prisma, role);
    users.push(u);
    await prisma.user.update({
      where: { id: u.id },
      data: { totpSecret: STAFF_TOTP, totpEnabledAt: new Date() },
    });
    const v = await (
      await call('/auth/otp/verify', '', 'POST', { email: u.email, code: '123456' })
    ).json();
    const done = await (
      await call('/auth/mfa/complete', '', 'POST', {
        ticket: v.ticket,
        code: totpCode(STAFF_TOTP),
      })
    ).json();
    return done.accessToken as string;
  }

  it('rejects cookie-authenticated mutations without the CSRF header', async () => {
    const u = await fixture(prisma, 'member');
    users.push(u);
    const res = await fetch(`${origin}/api/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, code: '123456' }),
    });
    expect(res.status).toBe(201);
    const setCookies = res.headers.getSetCookie();
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
    const csrf = setCookies
      .find((c) => c.startsWith('aucn_csrf='))
      ?.split(';')[0]
      .split('=')[1];
    expect(csrf).toBeTruthy();
    const mutate = (headers: Record<string, string>) =>
      fetch(`${origin}/api/v1/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieHeader, ...headers },
        body: JSON.stringify({ displayName: 'Cookie User' }),
      });
    // Cookie session without (or with a wrong) CSRF token is rejected.
    expect((await mutate({})).status).toBe(403);
    expect((await mutate({ 'x-csrf-token': 'wrong' })).status).toBe(403);
    // The matching double-submit token lets the write through.
    expect((await mutate({ 'x-csrf-token': csrf! })).status).toBe(200);
  });

  it('registers and removes web push subscriptions', async () => {
    const token = await memberLogin();
    const endpoint = `https://push.example/${randomUUID()}`;
    const res = await call('/me/push-subscriptions', token, 'POST', {
      endpoint,
      keys: { p256dh: 'dGVzdC1wMjU2ZGgta2V5', auth: 'dGVzdC1hdXRoLXNlY3JldA' },
    });
    expect(res.status).toBe(201);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
    expect((await call('/me/push-subscriptions', token, 'DELETE', { endpoint })).status).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });

  it('orders listings by distance for sort=near', async () => {
    const trusted = await staffLogin('admin');
    const sydney = await (
      await call('/listings', trusted, 'POST', {
        ...input(),
        title: 'Sydney desk',
        lat: -33.865,
        lng: 151.205,
      })
    ).json();
    const melbourne = await (
      await call('/listings', trusted, 'POST', {
        ...input(),
        title: 'Melbourne desk',
        lat: -37.81,
        lng: 144.963,
      })
    ).json();
    expect(sydney.id).toBeTruthy();
    const page = await (await call('/listings?sort=near&lat=-33.868&lng=151.209&limit=50')).json();
    const ids = page.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(sydney.id);
    expect(ids).toContain(melbourne.id);
    expect(ids.indexOf(sydney.id)).toBeLessThan(ids.indexOf(melbourne.id));
    // Keyset pagination: the second page continues strictly after the first.
    if (page.nextCursor) {
      const next = await (
        await call(
          `/listings?sort=near&lat=-33.868&lng=151.209&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
        )
      ).json();
      expect(next.items.every((i: { id: string }) => !ids.slice(0, 1).includes(i.id))).toBe(true);
    }
  });

  it('requires a second editor to approve before publishing when dual approval is on', async () => {
    await prisma.appConfig.upsert({
      where: { key: 'cms' },
      create: { key: 'cms', value: { dualApproval: true } },
      update: { value: { dualApproval: true } },
    });
    const editor = await staffLogin('editor');
    const approver = await staffLogin('admin');
    try {
      const article = {
        slug: `dual-${randomUUID()}`,
        title: 'Dual approval article',
        summary: 'Dual approval article summary.',
        body: 'Dual approval article body text.',
        category: 'life',
        locale: 'en',
        source: null,
        status: 'draft',
      };
      const row = await (await call('/admin/articles', editor, 'POST', article)).json();
      // Publishing without sign-off is rejected.
      expect(
        (
          await call(`/admin/articles/${row.id}`, editor, 'PATCH', {
            ...article,
            status: 'published',
            updatedAt: row.updatedAt,
          })
        ).status,
      ).toBe(403);
      // The author cannot approve their own article.
      expect((await call(`/admin/articles/${row.id}/approve`, editor, 'POST')).status).toBe(403);
      // A second editor approves, then publish succeeds.
      const approved = await call(`/admin/articles/${row.id}/approve`, approver, 'POST');
      expect(approved.status).toBe(201);
      const approvedRow = await approved.json();
      expect(
        (
          await call(`/admin/articles/${row.id}`, editor, 'PATCH', {
            ...article,
            status: 'published',
            updatedAt: approvedRow.updatedAt,
          })
        ).status,
      ).toBe(200);
    } finally {
      await prisma.appConfig.deleteMany({ where: { key: 'cms' } });
    }
  });
});

describe.sequential('pulse pipeline and weekend multi-city', () => {
  let feedItemId = '';
  let feedItemUpdatedAt = '';
  let sydneyCity = '';
  beforeAll(async () => {
    sydneyCity = (
      await prisma.city.create({
        data: {
          slug: `syd-${randomUUID()}`,
          state: 'NSW',
          nameZh: '悉尼',
          nameEn: 'Sydney',
          timezone: 'Australia/Sydney',
        },
      })
    ).id;
    await prisma.feedSource.create({
      data: {
        id: `test-src-${randomUUID().slice(0, 8)}`,
        name: 'Test Feed',
        url: 'https://example.com/feed',
        format: 'rss',
        category: 'news',
        enabled: false,
      },
    });
    const src = await prisma.feedSource.findFirst({ where: { name: 'Test Feed' } });
    const item = await prisma.feedItem.create({
      data: {
        fingerprint: `test-${randomUUID()}`,
        sourceId: src!.id,
        category: 'news',
        title: 'Test news item for pulse feed',
        summary: 'Summary of the test news item.',
        sourceName: 'Test Feed',
        sourceUrl: 'https://example.com/item-1',
        status: 'pending',
        publishedAt: new Date(),
      },
    });
    feedItemId = item.id;
    feedItemUpdatedAt = item.updatedAt.toISOString();
    await prisma.pulseMetric.create({
      data: {
        kind: 'exchange_rate',
        payload: { base: 'AUD', rates: { CNY: 4.72 } },
      },
    });
    await prisma.weekendEvent.create({
      data: {
        fingerprint: `wk-${randomUUID()}`,
        sourceName: 'Manual',
        sourceUrl: 'https://example.com/ev',
        title: 'Sydney family picnic day',
        summary: 'A family friendly picnic.',
        cityId: sydneyCity,
        category: 'family',
        suburb: 'Parramatta',
        venue: 'Park',
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 2 * 86400000),
        status: 'published',
      },
    });
  });
  afterAll(async () => {
    await prisma.weekendEvent.deleteMany({ where: { fingerprint: { startsWith: 'wk-' } } });
    await prisma.pulseMetric.deleteMany({ where: { kind: 'exchange_rate' } });
    await prisma.feedItem.deleteMany({ where: { fingerprint: { startsWith: 'test-' } } });
    await prisma.feedSource.deleteMany({ where: { name: 'Test Feed' } });
    await prisma.article.deleteMany({ where: { slug: { startsWith: 'daily-' } } });
    await prisma.appConfig.deleteMany({ where: { key: 'digest_author_id' } });
    await prisma.user.deleteMany({ where: { displayName: 'AUCN 编辑部' } });
    if (sydneyCity) await prisma.city.delete({ where: { id: sydneyCity } });
  });

  it('serves the dashboard with metrics and upcoming events', async () => {
    const res = await call('/pulse/dashboard');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.some((m: { kind: string }) => m.kind === 'exchange_rate')).toBe(true);
    expect(body.newListings).toBeGreaterThanOrEqual(0);
    const syd = await prisma.city.findUnique({ where: { id: sydneyCity } });
    const cityRes = await call(`/pulse/dashboard?city=${syd!.slug}`);
    expect(cityRes.status).toBe(200);
    const cityBody = await cityRes.json();
    expect(cityBody.events.some((e: { title: string }) => e.title.includes('picnic'))).toBe(true);
  });

  it('publishes a pending feed item via editor review and serves it publicly', async () => {
    // Members cannot reach the review endpoints. Fresh member — the shared
    // member tokens were intentionally revoked/banned by earlier tests.
    const member = await fixture(prisma, 'member');
    users.push(member);
    await challenge(prisma, member.email);
    const login = await call('/auth/otp/verify', '', 'POST', {
      email: member.email,
      code: '123456',
    });
    expect(login.status).toBe(201);
    const memberToken = (await login.json()).accessToken as string;
    expect(
      (
        await call(`/pulse/admin/items/${feedItemId}`, memberToken, 'PATCH', {
          title: 'Valid title here',
          summary: 'x',
          status: 'published',
          updatedAt: feedItemUpdatedAt,
        })
      ).status,
    ).toBe(403);
    const res = await call(`/pulse/admin/items/${feedItemId}`, editorToken, 'PATCH', {
      title: 'Test news item for pulse feed',
      summary: 'Summary of the test news item.',
      status: 'published',
      updatedAt: feedItemUpdatedAt,
    });
    expect(res.status).toBe(200);
    const feed = await (await call('/pulse/feed?category=news')).json();
    expect(feed.items.some((i: { id: string }) => i.id === feedItemId)).toBe(true);
    // Source management: non-staff rejected.
    expect((await call('/pulse/admin/sources', memberToken)).status).toBe(403);
    const sources = await (await call('/pulse/admin/sources', editorToken)).json();
    expect(sources.items.length).toBeGreaterThanOrEqual(1);
  });

  it('filters weekend events by city and category', async () => {
    const syd = await prisma.city.findUnique({ where: { id: sydneyCity } });
    const res = await call(`/weekend/events?period=upcoming&city=${syd!.slug}&category=family`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].title).toContain('picnic');
    // Wrong category excludes it.
    const none = await (
      await call(`/weekend/events?period=upcoming&city=${syd!.slug}&category=social`)
    ).json();
    expect(none.items.length).toBe(0);
  });

  it('writes morning/midday/evening digest articles per Sydney day', async () => {
    const { PulseService } = await import('../src/modules/pulse/pulse.service');
    const svc = new PulseService(prisma as never);
    // 09:00 Sydney == 23:00 UTC previous day (AEST, no DST in Sept).
    const nineAmSydney = new Date(Date.UTC(2026, 8, 17, 23, 0));
    await svc.maybeWriteDigest(nineAmSydney);
    const zh = await prisma.article.findFirst({
      where: { slug: 'daily-2026-09-18-morning-zh' },
    });
    expect(zh).toBeTruthy();
    expect(zh!.status).toBe('published');
    // Later editions don't exist yet at 09:00.
    expect(
      await prisma.article.count({ where: { slug: { startsWith: 'daily-2026-09-18' } } }),
    ).toBe(2); // morning zh + en
    // 19:30 Sydney generates all three editions.
    const evening = new Date(Date.UTC(2026, 8, 18, 9, 30));
    await svc.maybeWriteDigest(evening);
    expect(
      await prisma.article.count({ where: { slug: { startsWith: 'daily-2026-09-18' } } }),
    ).toBe(6); // 3 editions × zh/en
    // Second run is idempotent.
    await svc.maybeWriteDigest(evening);
    expect(
      await prisma.article.count({ where: { slug: { startsWith: 'daily-2026-09-18' } } }),
    ).toBe(6);
  });
});
