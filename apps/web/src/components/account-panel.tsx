'use client';

import {  useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiBase, ApiError, type SessionDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { formatDate, formatDateTime } from '@/lib/format';

export function AccountPanel() {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadSessions = useCallback(async () => {
    const res = await api<{ items: SessionDto[] }>('/me/sessions', {
      token: await getAccessToken(),
    });
    setSessions(res.items);
  }, []);

  useEffect(() => {
    if (me) void loadSessions().catch(() => setError(tc('error')));
  }, [me, loadSessions, tc]);

  if (!me) return null;

  async function uploadAvatar(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${apiBase()}/api/v1/media/avatar`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await getAccessToken()}` },
        body: form,
      });
      if (!res.ok) throw new ApiError({ title: res.statusText, status: res.status });
      window.dispatchEvent(new Event('aucn-auth'));
    } catch (e) {
      setError(e instanceof Error ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await api(`/me/sessions/${id}`, { method: 'DELETE', token: await getAccessToken() });
      await loadSessions();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  async function exportData() {
    setBusy(true);
    try {
      const data = await api<Record<string, unknown>>('/me/export', {
        token: await getAccessToken(),
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aucn-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  async function requestDeletion() {
    setBusy(true);
    setError(null);
    try {
      await api('/me/deletion', { method: 'POST', token: await getAccessToken() });
      setConfirmDelete(false);
      setNotice(t('deletionRequested'));
      window.dispatchEvent(new Event('aucn-auth'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    try {
      await api('/me/deletion', { method: 'DELETE', token: await getAccessToken() });
      setNotice(null);
      window.dispatchEvent(new Event('aucn-auth'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      <h2 className="font-semibold">{t('securityTitle')}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && <p className="text-xs text-amber-700">{notice}</p>}

      <div className="flex items-center gap-4">
        {me.avatarMediaId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${apiBase()}/api/v1/media/${me.avatarMediaId}`}
            alt={t('avatar')}
            className="w-14 h-14 rounded-full object-cover border border-gray-200"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-muted">
            {me.displayName.slice(0, 1)}
          </div>
        )}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAvatar(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="text-sm text-brand underline disabled:opacity-50"
          >
            {t('changeAvatar')}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">{t('sessions')}</h3>
        <ul className="divide-y divide-gray-100 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="truncate">{s.userAgent ?? t('unknownDevice')}</div>
                <div className="text-xs text-muted">
                  {formatDateTime(s.createdAt)} ·{' '}
                  {s.current ? t('currentSession') : formatDate(s.expiresAt)}
                </div>
              </div>
              {!s.current && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(s.id)}
                  className="text-xs text-red-600 underline disabled:opacity-50"
                >
                  {t('revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t pt-4 space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportData()}
          className="text-sm text-brand underline disabled:opacity-50"
        >
          {t('export')}
        </button>
        {me.deletionRequestedAt ? (
          <div className="text-sm">
            <p className="text-amber-700">
              {t('deletionPending', { date: formatDate(me.deletionRequestedAt) })}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancelDeletion()}
              className="text-brand underline"
            >
              {t('cancelDeletion')}
            </button>
          </div>
        ) : !confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="block text-sm text-red-600 underline"
          >
            {t('deleteAccount')}
          </button>
        ) : (
          <div className="text-sm space-y-2">
            <p>{t('deleteConfirm')}</p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestDeletion()}
                className="rounded bg-red-600 text-white px-3 py-1 disabled:opacity-50"
              >
                {t('deleteConfirmButton')}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-muted">
                {tc('cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
