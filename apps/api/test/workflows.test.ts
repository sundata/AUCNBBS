import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import sharp from 'sharp';
import { testDatabase, fixture, challenge } from './fixtures';
const prisma = testDatabase();
const origin = process.env.TEST_API_URL ?? 'http://localhost:4100';
const users: Awaited<ReturnType<typeof fixture>>[] = [];
let ownerToken = '',
  buyerToken = '',
  adminToken = '',
  editorToken = '',
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
beforeAll(async () => {
  for (const role of ['member', 'member', 'admin', 'editor'] as const)
    users.push(await fixture(prisma, role));
  const tokens = [];
  for (const user of users) {
    const res = await call('/auth/otp/verify', '', 'POST', { email: user.email, code: '123456' });
    expect(res.status).toBe(201);
    tokens.push(await res.json());
  }
  [ownerToken, buyerToken, adminToken, editorToken] = tokens.map((t) => t.accessToken);
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
  await prisma.payment.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { buyerId: { in: ids } } });
  await prisma.report.deleteMany({ where: { reporterId: { in: ids } } });
  await prisma.media.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.listing.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.article.deleteMany({ where: { authorId: { in: ids } } });
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
  it('creates a listing; denies edits from another account and stale versions', async () => {
    const created = await call('/listings', ownerToken, 'POST', input());
    expect(created.status).toBe(201);
    const row = await created.json();
    listingId = row.id;
    expect(
      (
        await call(`/listings/${listingId}`, buyerToken, 'PATCH', {
          version: row.version,
          listing: input(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/listings/${listingId}`, ownerToken, 'PATCH', {
          version: row.version,
          listing: { ...input(), title: 'Updated desk' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/listings/${listingId}`, ownerToken, 'PATCH', {
          version: row.version,
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
});
