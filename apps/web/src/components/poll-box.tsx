'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, type PollDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { Link } from '@/i18n/routing';

export function PollBox({ postId, poll }: { postId: string; poll: PollDto }) {
  const t = useTranslations('community');
  const { me } = useAuth();
  const [state, setState] = useState(poll);
  const [sel, setSel] = useState<string[]>(poll.myOptionIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const voted = state.myOptionIds.length > 0 || state.closed;
  const toggle = (id: string) =>
    setSel((s) => (state.multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  return (
    <div className="mt-4 border rounded-lg p-4 space-y-2">
      <p className="text-sm font-medium">
        {t('pollTitle', { count: state.totalVotes })}
        {state.closed && <span className="text-muted ml-2">{t('pollClosed')}</span>}
      </p>
      <ul className="space-y-1">
        {state.options.map((o) => {
          const pct = state.totalVotes ? Math.round((o.votes / state.totalVotes) * 100) : 0;
          return (
            <li key={o.id}>
              <label className="flex items-center gap-2 text-sm">
                {!voted && (
                  <input
                    type={state.multi ? 'checkbox' : 'radio'}
                    name="poll"
                    checked={sel.includes(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                )}
                <span className="flex-1">{o.label}</span>
                {voted && (
                  <span className="text-xs text-muted">
                    {o.votes} · {pct}%
                  </span>
                )}
              </label>
              {voted && (
                <div className="h-1 bg-gray-100 rounded mt-0.5">
                  <div className="h-1 bg-brand rounded" style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!me && (
        <Link href="/login?next=/community" className="text-sm text-brand">
          {t('loginToVote')}
        </Link>
      )}
      {me && !voted && (
        <button
          disabled={busy || sel.length === 0}
          className="text-sm bg-brand text-white rounded px-3 py-1 disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            setError('');
            void (async () => {
              const token = await getAccessToken();
              const next = await api<PollDto>(`/community/posts/${postId}/vote`, {
                method: 'POST',
                token,
                body: JSON.stringify({ optionIds: sel }),
              });
              setState(next);
            })()
              .catch((e) => setError(e instanceof Error ? e.message : t('error')))
              .finally(() => setBusy(false));
          }}
        >
          {t('vote')}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
