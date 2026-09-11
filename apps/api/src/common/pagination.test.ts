import { describe, expect, it } from 'vitest';
import { cursorQuerySchema, decodeCursor, encodeCursor, toPage } from './pagination';

describe('pagination', () => {
  it('round-trips cursors', () => {
    const at = new Date('2026-09-02T00:00:00.000Z');
    const c = encodeCursor(at, 'abc');
    expect(decodeCursor(c)).toEqual({ createdAt: at, id: 'abc' });
  });

  it('rejects malformed cursors', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('slices one extra row into nextCursor', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id${n}`, createdAt: new Date(2026, 0, n) }));
    const page = toPage(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(encodeCursor(rows[1].createdAt, 'id2'));
    expect(toPage(rows, 3).nextCursor).toBeNull();
  });

  it('caps limit at 50', () => {
    expect(cursorQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(cursorQuerySchema.parse({}).limit).toBe(20);
  });
});
