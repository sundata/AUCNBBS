import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryEndpoint } from './send-daily-note.mjs';
test('delivery origin requires HTTPS except loopback and cannot contain credentials', () => {
  assert.equal(
    deliveryEndpoint('https://example.com'),
    'https://example.com/api/v1/daily-notes/import',
  );
  assert.equal(
    deliveryEndpoint('http://127.0.0.1:4100'),
    'http://127.0.0.1:4100/api/v1/daily-notes/import',
  );
  for (const url of [
    'http://example.com',
    'https://secret@example.com',
    'https://example.com/api',
    'https://example.com/?key=secret',
  ])
    assert.throws(() => deliveryEndpoint(url));
});
