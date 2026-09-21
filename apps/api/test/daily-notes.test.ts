import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { Module, VersioningType, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaModule } = require('../dist/modules/prisma/prisma.module.js');
const { DailyNotesModule } = require('../dist/modules/daily-notes/daily-notes.module.js');
const { AuthService } = require('../dist/modules/auth/auth.service.js');
import { ProblemDetailsFilter } from '../src/common/problem-details.filter';
import { testDatabase, fixture } from './fixtures';
@Module({ imports: [PrismaModule, DailyNotesModule] })
class TestModule {}
const db = testDatabase();
const prefix = `test-${randomUUID()}`;
const key = 'integration-delivery-key-only-not-production';
let app: INestApplication;
let origin: string;
let image: Buffer;
let editorToken: string;
let memberToken: string;
let staffId: string;
let memberId: string;
let id: string;
const input = {
  deliveryId: prefix,
  city: 'melbourne',
  edition: '2026-09-20',
  title: '测试墨尔本每日图文',
  summary: '测试图文传输，不是真实新闻，不应上线。',
  body: '测试图片与正文原子传输、草稿发布和重复投递。这不是实际新闻报道。',
  tags: ['测试'],
  sources: [{ title: '测试来源', url: 'https://example.com' }],
  imageKind: 'generated',
  imageCredit: '测试配图',
  imageAlt: '测试色块',
};
const oldKey = process.env.DAILY_NOTES_INGEST_KEY;
const oldPublish = process.env.DAILY_NOTES_AUTO_PUBLISH;
beforeAll(async () => {
  process.env.DAILY_NOTES_INGEST_KEY = key;
  process.env.DAILY_NOTES_AUTO_PUBLISH = 'false';
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
  image = await sharp({ create: { width: 16, height: 24, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  const staff = await fixture(db, 'editor');
  staffId = staff.id;
  const member = await fixture(db);
  memberId = member.id;
  await db.user.update({ where: { id: staff.id }, data: { totpEnabledAt: new Date() } });
  editorToken = (await app.get(AuthService).issueSession(staff.id, 'editor')).accessToken;
  memberToken = (await app.get(AuthService).issueSession(member.id, 'member')).accessToken;
});
afterAll(async () => {
  const notes = await db.dailyNote.findMany({
    where: { deliveryId: { startsWith: prefix } },
    select: { id: true },
  });
  await db.auditLog.deleteMany({ where: { subject: { in: notes.map((n) => n.id) } } });
  await db.dailyNote.deleteMany({ where: { deliveryId: { startsWith: prefix } } });
  await db.otpChallenge.deleteMany({ where: { email: { contains: prefix } } });
  for (const uid of [staffId, memberId].filter(Boolean)) {
    const identities = await db.identity.findMany({ where: { userId: uid } });
    await db.otpChallenge.deleteMany({
      where: { email: { in: identities.map((i) => i.providerSubject) } },
    });
    await db.identity.deleteMany({ where: { userId: uid } });
    await db.session.deleteMany({ where: { userId: uid } });
    await db.user.delete({ where: { id: uid } });
  }
  await app?.close();
  await db.$disconnect();
  if (oldKey === undefined) delete process.env.DAILY_NOTES_INGEST_KEY;
  else process.env.DAILY_NOTES_INGEST_KEY = oldKey;
  if (oldPublish === undefined) delete process.env.DAILY_NOTES_AUTO_PUBLISH;
  else process.env.DAILY_NOTES_AUTO_PUBLISH = oldPublish;
});
async function send(payload: unknown = input, bytes: Buffer = image, token = key) {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  form.set('cover', new Blob([new Uint8Array(bytes)]), 'cover.png');
  return fetch(`${origin}/api/v1/daily-notes/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}
async function api(path: string, token?: string, method = 'GET', body?: unknown) {
  return fetch(`${origin}/api/v1/daily-notes${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
describe('daily note delivery over HTTP', () => {
  it('rejects wrong key, bad image and source payload', async () => {
    expect((await send(input, image, 'wrong')).status).toBe(401);
    expect((await send(input, Buffer.from('<svg/>'))).status).toBe(422);
    expect((await send({ ...input, sources: [] })).status).toBe(422);
  });
  it('atomically accepts image+text and deduplicates concurrent delivery', async () => {
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const receipts = await Promise.all(results.map((r) => r.json()));
    id = receipts[0].id;
    expect(receipts[1].id).toBe(id);
    expect(receipts.filter((r) => r.duplicate)).toHaveLength(1);
    expect(receipts[0].status).toBe('draft');
    expect(await db.dailyNote.count({ where: { deliveryId: prefix } })).toBe(1);
  });
  it('rejects changed content with the same delivery ID', async () => {
    expect((await send({ ...input, title: '另一个不同的测试标题' })).status).toBe(409);
  });
  it('hides drafts and denies member access to editor preview', async () => {
    expect((await api(`/${id}`)).status).toBe(404);
    expect((await api(`/${id}/cover`)).status).toBe(404);
    expect((await api('/admin/items', memberToken)).status).toBe(403);
    expect((await api(`/admin/${id}/cover`, memberToken)).status).toBe(403);
    const preview = await api(`/admin/${id}/cover`, editorToken);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toContain('image/webp');
  });
  it('publishes then hides text+cover and prevents stale reviews', async () => {
    const row = await db.dailyNote.findUniqueOrThrow({ where: { id } });
    expect(
      (
        await api(`/admin/${id}`, editorToken, 'PATCH', {
          status: 'published',
          updatedAt: row.updatedAt.toISOString(),
        })
      ).status,
    ).toBe(200);
    const published = await (await api(`/${id}`)).json();
    expect(published.title).toBe(input.title);
    expect((await api(`/${id}/cover`)).status).toBe(200);
    expect(
      (
        await api(`/admin/${id}`, editorToken, 'PATCH', {
          status: 'hidden',
          updatedAt: row.updatedAt.toISOString(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(`/admin/${id}`, editorToken, 'PATCH', {
          status: 'hidden',
          updatedAt: published.updatedAt,
        })
      ).status,
    ).toBe(200);
    expect((await api(`/${id}/cover`)).status).toBe(404);
    expect((await (await send()).json()).status).toBe('hidden');
  });
  it('only auto-publishes when enabled on the receiving server', async () => {
    process.env.DAILY_NOTES_AUTO_PUBLISH = 'true';
    const result = await (await send({ ...input, deliveryId: `${prefix}-auto` })).json();
    expect(result.status).toBe('published');
    expect((await api(`/${result.id}`)).status).toBe(200);
  });
});
