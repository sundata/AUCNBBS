'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError, type BusinessReviewDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

export function ClaimForm({ businessId }: { businessId: string }) {
  const t = useTranslations('businesses');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  if (done) return <p className="text-xs text-green-700">{t('claimSent')}</p>;
  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-brand underline"
        >
          {t('claim')}
        </button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void (async () => {
              await api(`/businesses/${businessId}/claim`, {
                method: 'POST',
                token: await getAccessToken(),
                body: JSON.stringify({ evidence }),
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
            rows={3}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder={t('claimPlaceholder')}
            className="w-full border rounded p-2 text-sm"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            disabled={busy || evidence.trim().length < 10}
            className="text-xs rounded bg-brand text-white px-3 py-1 disabled:opacity-50"
          >
            {t('claimSubmit')}
          </button>
        </form>
      )}
    </div>
  );
}

export function ReviewForm({
  businessId,
  onPosted,
}: {
  businessId: string;
  onPosted: (review: BusinessReviewDto) => void;
}) {
  const t = useTranslations('businesses');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return <p className="text-sm text-muted">{t('loginToReview')}</p>;
  return (
    <form
      className="space-y-2 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void (async () => {
          const review = await api<BusinessReviewDto>(`/businesses/${businessId}/reviews`, {
            method: 'POST',
            token: await getAccessToken(),
            body: JSON.stringify({ rating, body }),
          });
          setBody('');
          onPosted(review);
        })()
          .catch((err) => setError(err instanceof ApiError ? err.message : tc('error')))
          .finally(() => setBusy(false));
      }}
    >
      <label className="block text-sm">
        {t('rating')}
        <select
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="ml-2 border rounded px-2 py-1"
        >
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {'★'.repeat(r)}
            </option>
          ))}
        </select>
      </label>
      <textarea
        required
        minLength={10}
        maxLength={2000}
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('reviewPlaceholder')}
        className="w-full border rounded p-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        disabled={busy || body.trim().length < 10}
        className="rounded bg-brand text-white px-4 py-1.5 text-sm disabled:opacity-50"
      >
        {t('reviewSubmit')}
      </button>
    </form>
  );
}

export function ReviewReplyForm({
  businessId,
  reviewId,
  onPosted,
}: {
  businessId: string;
  reviewId: string;
  onPosted: (reply: string) => void;
}) {
  const t = useTranslations('businesses');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand underline">
        {t('reply')}
      </button>
    );
  return (
    <form
      className="space-y-2 mt-1"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void (async () => {
          await api(`/businesses/${businessId}/reviews/${reviewId}/reply`, {
            method: 'POST',
            token: await getAccessToken(),
            body: JSON.stringify({ reply }),
          });
          onPosted(reply);
        })()
          .catch((err) => setError(err instanceof ApiError ? err.message : tc('error')))
          .finally(() => setBusy(false));
      }}
    >
      <textarea
        required
        maxLength={2000}
        rows={2}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        className="w-full border rounded p-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        disabled={busy || !reply.trim()}
        className="text-xs rounded bg-brand text-white px-3 py-1 disabled:opacity-50"
      >
        {t('replySubmit')}
      </button>
    </form>
  );
}
