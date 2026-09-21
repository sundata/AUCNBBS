import { z } from 'zod';
export const sourceUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'Sources must use HTTPS without credentials');
export const dailyNoteInput = z
  .object({
    deliveryId: z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,159}$/),
    city: z.enum(['melbourne', 'tokyo', 'both']),
    edition: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const d = new Date(`${v}T00:00:00Z`);
        return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
      }, 'Invalid edition date'),
    title: z.string().trim().min(4).max(160),
    summary: z.string().trim().min(10).max(500),
    body: z.string().trim().min(20).max(30000),
    tags: z.array(z.string().trim().min(1).max(40)).max(12),
    sources: z
      .array(z.object({ title: z.string().trim().min(1).max(200), url: sourceUrl }).strict())
      .min(1)
      .max(20),
    imageKind: z.enum(['generated', 'owned', 'licensed']),
    imageCredit: z.string().trim().min(1).max(300),
    imageAlt: z.string().trim().min(1).max(300),
  })
  .strict();
export const noteSelect = {
  id: true,
  deliveryId: true,
  city: true,
  edition: true,
  title: true,
  summary: true,
  body: true,
  tags: true,
  sources: true,
  imageKind: true,
  imageCredit: true,
  imageAlt: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
