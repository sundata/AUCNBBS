'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

/** Subscribe to collected-intel alerts: keyword + max price → saved_search match. */
export function IntelAlert({ category, label }: { category: string; label: string }) {
  const loc = useLocale();
  const zh = loc === 'zh';
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  if (done)
    return <span className="text-xs text-brand">{zh ? '已订阅 ✓' : 'Subscribed ✓'}</span>;

  return (
    <span className="inline-flex items-center gap-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-brand underline"
        >
          {zh ? '订阅行情提醒' : 'Price alerts'}
        </button>
      ) : (
        <form
          className="inline-flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            const maxPriceCents = maxPrice ? Math.round(Number(maxPrice) * 100) : undefined;
            void (async () => {
              await api('/me/saved-searches', {
                method: 'POST',
                token: await getAccessToken(),
                body: JSON.stringify({
                  name:
                    `${label}${keyword ? ` ${keyword}` : ''}${maxPrice ? ` ≤$${maxPrice}` : ''}`.slice(
                      0,
                      80,
                    ),
                  query: keyword.trim() || '*',
                  cadence,
                  filters: {
                    target: 'feed',
                    category,
                    ...(maxPriceCents ? { maxPriceCents } : {}),
                  },
                }),
              });
              setDone(true);
            })()
              .catch((err) =>
                setError(err instanceof ApiError ? err.message : zh ? '保存失败' : 'Failed'),
              )
              .finally(() => setBusy(false));
          }}
        >
          <input
            maxLength={60}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={zh ? '关键词（如 Eastwood 两房）' : 'Keywords'}
            className="border rounded px-2 py-1 text-sm w-44"
          />
          <input
            inputMode="decimal"
            maxLength={7}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={zh ? '上限价 $' : 'Max $'}
            className="border rounded px-2 py-1 text-sm w-24"
          />
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="instant">{zh ? '即时' : 'Instant'}</option>
            <option value="daily">{zh ? '每天' : 'Daily'}</option>
            <option value="weekly">{zh ? '每周' : 'Weekly'}</option>
          </select>
          <button disabled={busy} className="text-sm text-brand underline">
            {zh ? '订阅' : 'Subscribe'}
          </button>
        </form>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
