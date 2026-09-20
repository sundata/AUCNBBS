import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(__dirname, 'App.tsx'), 'utf8');
const zh = JSON.parse(readFileSync(join(__dirname, '../web/messages/zh.json'), 'utf8')) as Record<
  string,
  Record<string, string>
>;
// The mobile app is a single-file Expo client that reuses the web message
// catalog. This spec guards the contract so a rename in App.tsx or the
// catalog fails in CI rather than surfacing as a raw key on a device.
describe('mobile message keys', () => {
  const used = [...src.matchAll(/\bt\('([a-zA-Z]+)\.([a-zA-Z0-9]+)'\)/g)].map(
    (m) => `${m[1]}.${m[2]}`,
  );
  it('uses a non-trivial number of keys', () => {
    expect(used.length).toBeGreaterThan(30);
  });
  it.each(used)('"%s" exists in zh catalog', (key) => {
    const [ns, k] = key.split('.');
    expect(zh[ns]?.[k], `zh missing ${key}`).toBeTruthy();
  });
});
