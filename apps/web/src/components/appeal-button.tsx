'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

/** Appeal a moderation outcome on content the current user owns. */
export function AppealButton({
  subjectType,
  subjectId,
}: {
  subjectType: 'listing' | 'post' | 'comment' | 'article';
  subjectId: string;
}) {
  const t = useTranslations('appeal');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me || done) return done ? <p className="text-xs text-green-700">{t('sent')}</p> : null;

  return (
    <div className="mt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-brand underline"
        >
          {t('open')}
        </button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            void (async () => {
              await api('/appeals', {
                method: 'POST',
                token: await getAccessToken(),
                body: JSON.stringify({ subjectType, subjectId, reason }),
              });
              setDone(true);
            })()
              .catch((err) => setError(err instanceof ApiError ? err.message : tc('error')))
              .finally(() => setBusy(false));
          }}
        >
          <textarea
            required
            minLength={10}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('placeholder')}
            className="w-full border rounded p-2 text-sm"
            rows={3}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              disabled={busy || reason.trim().length < 10}
              className="text-xs rounded bg-brand text-white px-3 py-1 disabled:opacity-50"
            >
              {t('submit')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted">
              {tc('cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
