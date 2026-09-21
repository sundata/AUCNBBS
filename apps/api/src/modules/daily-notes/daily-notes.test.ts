import { describe, expect, it, afterEach } from 'vitest';
import { dailyNoteInput } from './daily-notes.schema';
import { DeliveryGuard } from './delivery.guard';
import type { ExecutionContext } from '@nestjs/common';
const input = {
  deliveryId: 'melbourne-2026-09-20',
  city: 'melbourne',
  edition: '2026-09-20',
  title: '墨尔本测试内容',
  summary: '这是一篇用于验证格式的测试内容。',
  body: '这是一篇用于验证格式的测试内容，不是实际的新闻报道。',
  tags: ['生活'],
  sources: [{ title: '来源', url: 'https://example.com/' }],
  imageKind: 'generated',
  imageCredit: 'AI',
  imageAlt: '测试封面',
};
const original = process.env.DAILY_NOTES_INGEST_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.DAILY_NOTES_INGEST_KEY;
  else process.env.DAILY_NOTES_INGEST_KEY = original;
});
describe('daily note validation', () => {
  it('accepts real date and rejects invalid calendar date', () => {
    expect(dailyNoteInput.safeParse(input).success).toBe(true);
    expect(dailyNoteInput.safeParse({ ...input, edition: '2026-02-30' }).success).toBe(false);
  });
  it('rejects unsafe source links and missing provenance', () => {
    expect(
      dailyNoteInput.safeParse({ ...input, sources: [{ title: 'x', url: 'javascript:alert(1)' }] })
        .success,
    ).toBe(false);
    expect(dailyNoteInput.safeParse({ ...input, sources: [] }).success).toBe(false);
    expect(dailyNoteInput.safeParse({ ...input, imageKind: 'unknown' }).success).toBe(false);
  });
  it('does not accept a requested publication status from the sender', () => {
    expect(dailyNoteInput.safeParse({ ...input, status: 'published' }).success).toBe(false);
  });
  it('fails closed on missing/short key and wrong credentials', () => {
    const guard = new DeliveryGuard();
    const ctx = (authorization?: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
      }) as ExecutionContext;
    delete process.env.DAILY_NOTES_INGEST_KEY;
    expect(() => guard.canActivate(ctx())).toThrow();
    process.env.DAILY_NOTES_INGEST_KEY = 'a'.repeat(40);
    expect(() => guard.canActivate(ctx('Bearer bad'))).toThrow();
    expect(guard.canActivate(ctx(`Bearer ${'a'.repeat(40)}`))).toBe(true);
  });
});
