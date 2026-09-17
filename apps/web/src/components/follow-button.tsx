'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { Link } from '@/i18n/routing';

/** Follow/unfollow a user profile (§5.2). */
export function FollowButton({ subjectId }: { subjectId: string }) {
  const t = useTranslations('profile');
  const { me, loading } = useAuth();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!me || me.id === subjectId) return;
    void (async () => {
      const token = await getAccessToken();
      const s = await api<{ following: boolean }>(`/me/follows/user/${subjectId}`, { token });
      setFollowing(s.following);
    })().catch(() => setFollowing(false));
  }, [me, subjectId]);
  if (loading) return null;
  if (!me)
    return (
      <Link href={`/login?next=/users/${subjectId}`} className="text-sm text-brand underline">
        {t('follow')}
      </Link>
    );
  if (me.id === subjectId || following === null) return null;
  return (
    <button
      disabled={busy}
      className="text-sm border rounded px-3 py-1 disabled:opacity-50"
      onClick={() => {
        setBusy(true);
        void (async () => {
          const token = await getAccessToken();
          if (following) {
            await api(`/me/follows/user/${subjectId}`, { method: 'DELETE', token });
          } else {
            await api('/me/follows', {
              method: 'POST',
              token,
              body: JSON.stringify({ subjectType: 'user', subjectId }),
            });
          }
          setFollowing(!following);
        })().finally(() => setBusy(false));
      }}
    >
      {following ? t('unfollow') : t('follow')}
    </button>
  );
}
