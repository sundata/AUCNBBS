'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

export function RsvpButton({ eventId, initial }: { eventId: string; initial: string | null }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (status) {
        await api(`/events/${eventId}/rsvp`, { method: 'DELETE', token });
        setStatus(null);
      } else {
        const r = await api<{ status: string }>(`/events/${eventId}/rsvp`, {
          method: 'POST',
          token,
        });
        setStatus(r.status);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className={`text-sm rounded px-3 py-1.5 disabled:opacity-50 ${
          status ? 'border border-gray-300' : 'bg-brand text-white'
        }`}
      >
        {status === 'going'
          ? t('cancelRsvp')
          : status === 'waitlist'
            ? t('leaveWaitlist')
            : t('rsvp')}
      </button>
      {status && <span className="text-xs text-muted">{t(`rsvpState.${status}`)}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function EventCancelButton({ eventId }: { eventId: string }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <span className="text-xs text-muted">{t('cancelled')}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void (async () => {
            setBusy(true);
            try {
              await api(`/events/${eventId}/cancel`, {
                method: 'POST',
                token: await getAccessToken(),
              });
              setDone(true);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : tc('error'));
            } finally {
              setBusy(false);
            }
          })()
        }
        className="text-xs text-red-600 underline disabled:opacity-50"
      >
        {t('cancelEvent')}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
