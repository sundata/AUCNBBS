'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

/** Subscribe to collected-intel alerts: keyword + max price → saved_search match. */
export function IntelAlert({ category, label }: { category: string; label: string }) {
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
    return <span className="text-xs text-brand">{'已订阅 ✓'}</span>;

  return (
    <span className="inline-flex items-center gap-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-brand underline"
        >
          {'订阅行情提醒'}
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
                setError(err instanceof ApiError ? err.message : '保存失败'),
              )
              .finally(() => setBusy(false));
          }}
        >
          <input
            maxLength={60}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={'关键词（如 Eastwood 两房）'}
            className="border rounded px-2 py-1 text-sm w-44"
          />
          <input
            inputMode="decimal"
            maxLength={7}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={'上限价 $'}
            className="border rounded px-2 py-1 text-sm w-24"
          />
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="instant">{'即时'}</option>
            <option value="daily">{'每天'}</option>
            <option value="weekly">{'每周'}</option>
          </select>
          <button disabled={busy} className="text-sm text-brand underline">
            {'订阅'}
          </button>
        </form>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
