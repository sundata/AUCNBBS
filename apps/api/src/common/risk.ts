import type { PrismaService } from '../modules/prisma/prisma.service';

/**
 * Publish-time risk screening (§5.5): banned words, scam heuristics,
 * duplicate detection and price anomalies. Flags are stored on the listing
 * and any hit forces the content through the human review queue.
 */

export const DEFAULT_SENSITIVE_WORDS = [
  // Discriminatory / illegal-in-AU terms (kept minimal; admin can extend via app_config).
  'no chinese',
  'whites only',
  '不租给',
  '押金先转',
  'western union',
  'gift card',
  '礼品卡',
  '先付款再看房',
  'deposit before viewing',
];

const SCAM_PATTERNS: { flag: string; re: RegExp }[] = [
  { flag: 'advance_payment', re: /(先转|先付|预付).{0,8}(定金|押金|订金|deposit)/i },
  { flag: 'off_platform', re: /(whatsapp|telegram|wechat|微信).{0,10}(联系|详谈|私聊)/i },
  { flag: 'gift_card', re: /(gift\s*card|礼品卡|充值卡)/i },
  { flag: 'too_good_price', re: /(免费|免押金|no bond|free rent)/i },
];

/** Weekly rent sanity bounds in AUD cents (housing); monthly salary bounds for jobs. */
const PRICE_FLOORS: Record<string, { min: number; flag: string }> = {
  housing: { min: 5000, flag: 'price_anomaly' }, // < A$50/week is suspicious
  job: { min: 0, flag: 'salary_floor' },
};

/** Sensitive-word + scam-pattern flags for any user/external text (listings, feed items). */
export async function screenText(prisma: PrismaService, text: string): Promise<string[]> {
  const flags = new Set<string>();
  const cfg = await prisma.appConfig.findUnique({ where: { key: 'sensitive_words' } });
  const words = Array.isArray(cfg?.value) ? (cfg.value as string[]) : DEFAULT_SENSITIVE_WORDS;
  const lower = text.toLowerCase();
  for (const w of words) if (w && lower.includes(w.toLowerCase())) flags.add('sensitive_word');
  for (const { flag, re } of SCAM_PATTERNS) if (re.test(text)) flags.add(flag);
  return [...flags];
}

export async function riskScreenListing(
  prisma: PrismaService,
  input: {
    ownerId: string;
    type: string;
    title: string;
    body: string;
    priceMinor?: number | null;
    salaryMinMinor?: number | null;
  },
): Promise<string[]> {
  const flags = new Set<string>(await screenText(prisma, `${input.title}\n${input.body}`));

  const floor = PRICE_FLOORS[input.type];
  const price = input.type === 'job' ? input.salaryMinMinor : input.priceMinor;
  if (floor && price != null && price < floor.min) flags.add(floor.flag);
  if (input.type === 'item' && input.priceMinor === 0) flags.add('free_item');

  // Duplicate detection: same owner, same type, near-identical title in the last 7 days.
  const dup = await prisma.listing.findFirst({
    where: {
      ownerId: input.ownerId,
      type: input.type as never,
      title: input.title,
      status: { in: ['active', 'pending_review', 'draft', 'paused', 'reserved'] },
      createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) },
    },
    select: { id: true },
  });
  if (dup) flags.add('duplicate');

  return [...flags];
}

/** TFN / bank card / passport-style masking for private messages (§5.9). */
export function maskSensitiveNumbers(body: string): { body: string; masked: boolean } {
  let masked = false;
  const out = body.replace(/\b\d[\d -]{7,}\d\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    // 8-9 digit TFN, 13-19 card numbers, ABN (11) — mask anything ≥8 digits.
    if (digits.length >= 8 && digits.length <= 19) {
      masked = true;
      return `${digits.slice(0, 2)}${'•'.repeat(Math.min(digits.length - 4, 12))}${digits.slice(-2)}`;
    }
    return m;
  });
  return { body: out, masked };
}

export function containsLink(body: string): boolean {
  return /(https?:\/\/|www\.)/i.test(body);
}
