'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

export function SaveSearchButton({
  query,
  filters,
}: {
  query: string;
  filters?: Record<string, string | undefined>;
}) {
  const t = useTranslations('search');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(query);
  const [cadence, setCadence] = useState('daily');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || !query) return null;
  if (done) return <span className="text-xs text-green-700">{t('savedSearchDone')}</span>;

  return (
    <span className="inline-flex items-center gap-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-brand underline"
        >
          {t('saveSearch')}
        </button>
      ) : (
        <form
          className="inline-flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void (async () => {
              await api('/me/saved-searches', {
                method: 'POST',
                token: await getAccessToken(),
                body: JSON.stringify({
                  name,
                  query,
                  cadence,
                  filters: filters ?? undefined,
                }),
              });
              setDone(true);
            })()
              .catch((err) => setError(err instanceof ApiError ? err.message : tc('error')))
              .finally(() => setBusy(false));
          }}
        >
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            {['instant', 'daily', 'weekly', 'off'].map((c) => (
              <option key={c} value={c}>
                {t(`cadence.${c}`)}
              </option>
            ))}
          </select>
          <button disabled={busy || !name.trim()} className="text-sm text-brand underline">
            {t('saveConfirm')}
          </button>
        </form>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
