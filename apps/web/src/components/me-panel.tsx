'use client';

import {  useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';
import { api, ApiError, type ListingSummary, type Page, qs } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { OwnerActions } from './owner-actions';
import { isPubliclyVisible } from '@aucn/domain';
import { formatDate, LISTING_ROUTES } from '@/lib/format';

export function MePanel() {
  const t = useTranslations('me');
  const ta = useTranslations('auth');
  const tl = useTranslations('listing');
  const tc = useTranslations('common');
  const { me, loading } = useAuth();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [mine, setMine] = useState<ListingSummary[] | null>(null);

  useEffect(() => {
    if (me) setName(me.displayName);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const token = await getAccessToken();
      try {
        const page = await api<Page<ListingSummary>>('/listings/mine', { token });
        setMine(page.items);
        setNextCursor(page.nextCursor);
      } catch {
        setError(tc('error'));
        setMine([]);
      }
    })();
  }, [me, tc]);

  if (loading) return <p className="text-sm text-muted">{tc('loading')}</p>;
  if (!me) {
    return (
      <p className="text-sm">
        {ta('required')}{' '}
        <Link href="/login?next=/me" className="text-brand underline">
          {ta('title')}
        </Link>
      </p>
    );
  }

  async function save() {
    setError(null);
    setSaved(false);
    try {
      const token = await getAccessToken();
      await api('/me', { method: 'PATCH', token, body: JSON.stringify({ displayName: name }) });
      setSaved(true);
      window.dispatchEvent(new Event('aucn-auth'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h1 className="text-xl font-bold mb-3">{t('title')}</h1>
        <Link href="/billing" className="text-brand underline">
          {tl('billing')}
        </Link>
        <p className="text-sm text-muted mb-3">{me.email}</p>
        <label className="block text-sm max-w-xs">
          <span className="text-muted">{t('displayName')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={30}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            className="rounded bg-brand text-white px-4 py-1.5 text-sm"
          >
            {t('save')}
          </button>
          {saved && <span className="text-xs text-green-700">{t('saved')}</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </section>
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-3">{t('myListings')}</h2>
        {mine === null ? (
          <p className="text-sm text-muted">{tc('loading')}</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted">{tl('empty')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {mine.map((l) => (
              <li key={l.id} className="py-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100">
                    {tl(`status.${l.status}`)}
                  </span>
                  {isPubliclyVisible(l.status, new Date(l.expiresAt)) ? (
                    <Link
                      href={`/${LISTING_ROUTES[l.type]}/${l.id}`}
                      className="flex-1 hover:text-brand line-clamp-1"
                    >
                      {l.title}
                    </Link>
                  ) : (
                    <span className="flex-1 line-clamp-1">{l.title}</span>
                  )}
                  <span className="text-xs text-muted">
                    {tl(`type.${l.type}`)} · {formatDate(l.expiresAt)}
                  </span>
                </div>
                {!['removed', 'archived', 'completed', 'pending_review'].includes(l.status) && (
                  <Link href={`/listings/${l.id}/edit`} className="text-sm text-brand underline">
                    {tl('edit')}
                  </Link>
                )}
                <OwnerActions
                  userId={me.id}
                  listing={{ ...l, owner: { id: me.id } }}
                  onChanged={(updated) =>
                    setMine(
                      (rows) => rows?.map((row) => (row.id === updated.id ? updated : row)) ?? null,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {nextCursor && (
          <button
            disabled={moreBusy}
            className="mt-3 text-brand underline"
            onClick={() => {
              setMoreBusy(true);
              void (async () => {
                const page = await api<Page<ListingSummary>>(
                  `/listings/mine${qs({ cursor: nextCursor })}`,
                  { token: await getAccessToken() },
                );
                setMine((rows) => [...(rows ?? []), ...page.items]);
                setNextCursor(page.nextCursor);
              })()
                .catch(() => setError(tc('error')))
                .finally(() => setMoreBusy(false));
            }}
          >
            {tl('loadMore')}
          </button>
        )}
      </section>
    </div>
  );
}
