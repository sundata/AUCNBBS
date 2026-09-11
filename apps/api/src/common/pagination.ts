import { z } from 'zod';

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
  return { createdAt: new Date(ts), id };
}

export function toPage<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}
