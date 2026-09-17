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

/** Organizer-side door check-in: paste/scan the attendee code, get a name back. */
export function CheckinForm({ eventId }: { eventId: string }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; again: boolean } | null>(null);
  if (!me) return null;

  return (
    <form
      className="mt-4 rounded border border-gray-200 p-3 text-sm space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setResult(null);
        void (async () => {
          const r = await api<{
            user: { displayName: string };
            status: string;
            checkedInAt: string;
          }>(`/events/${eventId}/checkin`, {
            method: 'POST',
            token: await getAccessToken(),
            body: JSON.stringify({ code: code.trim() }),
          });
          setResult({ name: r.user.displayName, again: false });
          setCode('');
        })()
          .catch(async (e2) => {
            if (e2 instanceof ApiError && e2.problem.status === 404) setError(t('checkinInvalid'));
            else setError(e2 instanceof ApiError ? e2.message : tc('error'));
          })
          .finally(() => setBusy(false));
      }}
    >
      <label className="block">
        <span className="text-muted">{t('checkinLabel')}</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          minLength={6}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono"
          placeholder={t('checkinPlaceholder')}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-brand px-3 py-1.5 text-white disabled:opacity-50"
      >
        {t('checkinSubmit')}
      </button>
      {result && (
        <p role="status" className="text-green-700">
          {t('checkinOk', { name: result.name })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
