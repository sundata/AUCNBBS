'use client';

import { REPORT_REASONS } from '@aucn/domain';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-client';

type Reason = (typeof REPORT_REASONS)[number];

export function ReportButton({
  subjectType,
  subjectId,
}: {
  subjectType: 'listing' | 'post' | 'comment' | 'user' | 'article' | 'business' | 'event';
  subjectId: string;
}) {
  const t = useTranslations('report');
  const tc = useTranslations('common');
  const tl = useTranslations('listing');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const r = await api<{ reference: string }>('/reports', {
        method: 'POST',
        token,
        body: JSON.stringify({ subjectType, subjectId, reason, details: details || undefined }),
      });
      setResult(r.reference);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted hover:text-brand underline"
      >
        {tl('report')}
      </button>
    );
  }
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm space-y-2 max-w-md">
      <div className="font-medium">{t('title')}</div>
      {result ? (
        <p className="text-green-700">{t('success', { reference: result })}</p>
      ) : (
        <>
          <label className="block">
            <span className="text-xs text-muted">{t('reason')}</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reasons.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted">{t('details')}</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="rounded bg-brand text-white px-3 py-1 disabled:opacity-50"
            >
              {t('submit')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border px-3 py-1"
            >
              {tc('cancel')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
