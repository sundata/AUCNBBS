import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function deliveryEndpoint(base) {
  const url = new URL(base);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
  )
    throw new Error('Use an HTTPS API origin (HTTP allowed only for localhost)');
  if (url.pathname !== '/') throw new Error('DAILY_NOTES_API_URL must be an origin without a path');
  return new URL('/api/v1/daily-notes/import', url).href;
}
export async function sendDailyNote(manifestPath, env = process.env) {
  const endpoint = deliveryEndpoint(env.DAILY_NOTES_API_URL ?? '');
  const key = env.DAILY_NOTES_INGEST_KEY;
  if (!key || key.length < 32) throw new Error('Set DAILY_NOTES_INGEST_KEY (32+ characters)');
  const manifestFile = resolve(manifestPath);
  const raw = await readFile(manifestFile);
  if (raw.length > 150000) throw new Error('Manifest too large');
  const { coverFile, ...payload } = JSON.parse(raw.toString('utf8'));
  if (typeof coverFile !== 'string' || !coverFile) throw new Error('Manifest needs coverFile');
  const image = await readFile(resolve(dirname(manifestFile), coverFile));
  if (!image.length || image.length > 8 * 1024 * 1024) throw new Error('Cover must be 1 byte–8 MB');
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    form.set('cover', new Blob([image]), 'cover');
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      if (attempt === 2)
        throw new Error(
          'Delivery failed: network error or timeout; safe to retry the same manifest',
        );
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (response.ok) {
      const result = await response.json();
      if (!result.id || !['draft', 'published', 'hidden'].includes(result.status))
        throw new Error('Unexpected delivery receipt');
      return { id: result.id, status: result.status, duplicate: !!result.duplicate };
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    // Do not echo response bodies that may contain user content or infrastructure details.
    throw new Error(
      `Delivery rejected (HTTP ${response.status}). 401: key; 409: changed delivery ID; 422: payload/image; 503: receiver not configured.`,
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) {
    console.error('Usage: node --env-file=.env.delivery scripts/send-daily-note.mjs manifest.json');
    process.exitCode = 1;
  } else
    try {
      console.log(JSON.stringify(await sendDailyNote(process.argv[2])));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
