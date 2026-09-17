'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, type PostDetail } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

const STAFF = ['moderator', 'admin', 'super_admin'];
const MOD_ACTIONS = ['pin', 'unpin', 'lock', 'unlock', 'slowmode'] as const;

/** Owner edit + Q&A accept + moderator tools for a post. */
export function PostTools({ post, isOwner }: { post: PostDetail; isOwner: boolean }) {
  const t = useTranslations('community');
  const { me } = useAuth();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [slowmode, setSlowmode] = useState(60);
  const staff = !!me && STAFF.includes(me.role);
  if (!isOwner && !staff) return null;
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : t('error'));
  const mod = (action: string, extra: Record<string, unknown> = {}) =>
    void (async () => {
      await api(`/admin/posts/${post.id}/mod`, {
        method: 'POST',
        token: await getAccessToken(),
        body: JSON.stringify({ action, ...extra }),
      });
      location.reload();
    })().catch(fail);
  return (
    <div className="mt-4 space-y-2 text-sm">
      {isOwner && !editing && (
        <button className="text-brand underline" onClick={() => setEditing(true)}>
          {t('edit')}
        </button>
      )}
      {editing && (
        <form
          className="space-y-2 border rounded p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              await api(`/community/posts/${post.id}`, {
                method: 'PATCH',
                token: await getAccessToken(),
                body: JSON.stringify({ title, body }),
              });
              location.reload();
            })().catch(fail);
          }}
        >
          <input
            className="block w-full border rounded px-2 py-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="block w-full border rounded px-2 py-1 h-32"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="bg-brand text-white rounded px-3 py-1">{t('save')}</button>
            <button
              type="button"
              className="border rounded px-3 py-1"
              onClick={() => setEditing(false)}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}
      {staff && (
        <div className="flex flex-wrap gap-2 border-t pt-2">
          <span className="text-muted">{t('modTools')}</span>
          {MOD_ACTIONS.map((a) => (
            <button
              key={a}
              className="border rounded px-2 py-0.5 text-xs"
              onClick={() => mod(a, a === 'slowmode' ? { slowmodeSec: slowmode } : {})}
            >
              {t(`mod.${a}`)}
            </button>
          ))}
          <input
            type="number"
            min={0}
            max={86400}
            value={slowmode}
            onChange={(e) => setSlowmode(Number(e.target.value))}
            className="w-20 border rounded px-1 text-xs"
            aria-label={t('mod.slowmodeSec')}
          />
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

/** Question author marks a comment as the accepted answer. */
export function AcceptAnswer({
  postId,
  commentId,
  accepted,
  canAccept,
}: {
  postId: string;
  commentId: string;
  accepted: boolean;
  canAccept: boolean;
}) {
  const t = useTranslations('community');
  const [done, setDone] = useState(accepted);
  if (!canAccept && !done) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {done && <span className="text-xs text-green-700">✓ {t('accepted')}</span>}
      {canAccept && (
        <button
          className="text-xs text-brand underline"
          onClick={() =>
            void (async () => {
              const token = await getAccessToken();
              if (done) {
                await api(`/community/posts/${postId}/accept`, {
                  method: 'DELETE',
                  token,
                  body: JSON.stringify({ commentId }),
                });
              } else {
                await api(`/community/posts/${postId}/accept`, {
                  method: 'POST',
                  token,
                  body: JSON.stringify({ commentId }),
                });
              }
              setDone(!done);
            })().catch(() => undefined)
          }
        >
          {done ? t('unaccept') : t('accept')}
        </button>
      )}
    </span>
  );
}
