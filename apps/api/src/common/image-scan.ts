import { createHash, randomBytes } from 'node:crypto';

export interface ScanResult {
  verdict: 'clean' | 'infected' | 'nsfw' | 'suspicious';
  reason?: string;
}

/**
 * §5.10 image safety hook. Two layers, both optional and additive:
 *  - IMAGE_SCAN_BLOCKLIST: comma-separated sha256 hashes of known-bad content
 *    (works offline, deterministic).
 *  - IMAGE_SCAN_URL: external scanner endpoint (ClamAV REST, NSFW detector…)
 *    receiving `{contentBase64, mime}` and answering `{verdict, reason?}`.
 * Scanner outages never block uploads — the result is stored for moderation.
 */
export async function scanImage(buffer: Buffer, mime: string): Promise<ScanResult> {
  const sha = createHash('sha256').update(buffer).digest('hex');
  const blocklist = (process.env.IMAGE_SCAN_BLOCKLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (blocklist.includes(sha)) return { verdict: 'infected', reason: `sha256:${sha}` };

  const url = process.env.IMAGE_SCAN_URL;
  if (!url) return { verdict: 'clean' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentBase64: buffer.toString('base64'), mime }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { verdict: 'clean' };
    const body = (await res.json()) as { verdict?: string; reason?: string };
    if (body.verdict === 'infected' || body.verdict === 'nsfw' || body.verdict === 'suspicious')
      return { verdict: body.verdict, reason: body.reason };
    return { verdict: 'clean' };
  } catch {
    return { verdict: 'clean' };
  }
}

/** Test hook: deterministic verdict without a scanner (never set in production). */
export function forceScanVerdict(): ScanResult | null {
  if (process.env.NODE_ENV === 'production') return null;
  const v = process.env.IMAGE_SCAN_FORCE_VERDICT;
  return v === 'infected' || v === 'nsfw' || v === 'suspicious'
    ? { verdict: v, reason: `forced:${randomBytes(4).toString('hex')}` }
    : null;
}
