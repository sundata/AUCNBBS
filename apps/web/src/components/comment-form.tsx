'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Link } from '@/i18n/routing';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

export function CommentForm({
  postId,
  parentId,
  inline = false,
}: {
  postId: string;
  parentId?: string;
  inline?: boolean;
}) {
  const t = useTranslations('community');
  const tc = useTranslations('common');
  const { me, loading } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(!inline);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (!me) {
    return inline ? null : (
      <p className="text-sm text-muted">
        <Link href="/login" className="text-brand underline">
          {t('loginToReply')}
        </Link>
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted hover:text-brand underline"
      >
        {t('reply')}
      </button>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      await api(`/community/posts/${postId}/comments`, {
        method: 'POST',
        token,
        body: JSON.stringify({ body, parentId }),
      });
      setBody('');
      if (inline) setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-2 ${inline ? 'mt-2 w-full' : ''}`}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={inline ? 2 : 3}
        maxLength={4000}
        placeholder={t('replyPlaceholder')}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || body.trim().length === 0}
          onClick={() => void submit()}
          className="rounded bg-brand text-white px-3 py-1 text-sm disabled:opacity-50"
        >
          {t('reply')}
        </button>
        {inline && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border px-3 py-1 text-sm"
          >
            {tc('cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
