import { resolve4 } from 'node:dns/promises';
import { request } from 'node:https';
import { publicUrl } from './weekend.helpers';

export function publicIPv4(ip: string) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return false;
  const [a, b] = p;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
/** Pin validated DNS result; no redirects, cookies, credentials or unbounded bodies. */
export async function fetchFeed(url: string): Promise<string> {
  const u = new URL(publicUrl.parse(url));
  const addresses = await resolve4(u.hostname);
  if (!addresses.length || addresses.some((ip) => !publicIPv4(ip)))
    throw new Error('Source must resolve to public IPv4 addresses');
  return new Promise((resolve, reject) => {
    const req = request(
      u,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'AUCNHub-EventCollector/1.0',
          Accept:
            'application/rss+xml, application/atom+xml, application/json, application/xml, text/xml',
        },
        lookup: (_hostname, _options, callback) => callback(null, addresses[0], 4),
        family: 4,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Feed HTTP ${res.statusCode}; redirects are not followed`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_000_000) {
            req.destroy(new Error('Feed exceeds 1 MB'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    const timeout = setTimeout(
      () => req.destroy(new Error('Feed timed out after 15 seconds')),
      15000,
    );
    req.on('close', () => clearTimeout(timeout));
    req.on('error', reject);
    req.end();
  });
}
