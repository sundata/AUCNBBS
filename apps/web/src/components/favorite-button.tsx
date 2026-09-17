'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

export function FavoriteButton({
  subjectType,
  subjectId,
}: {
  subjectType: 'listing' | 'post' | 'article' | 'business' | 'event';
  subjectId: string;
}) {
  const t = useTranslations('favorite');
  const { me } = useAuth();
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const state = await api<{ favorited: boolean }>(`/me/favorites/${subjectType}/${subjectId}`, {
        token: await getAccessToken(),
      });
      setFavorited(state.favorited);
    })().catch(() => undefined);
  }, [me, subjectType, subjectId]);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (favorited) {
        await api(`/me/favorites/${subjectType}/${subjectId}`, { method: 'DELETE', token });
      } else {
        await api('/me/favorites', {
          method: 'POST',
          token,
          body: JSON.stringify({ subjectType, subjectId }),
        });
      }
      setFavorited(!favorited);
    } finally {
      setBusy(false);
    }
  }, [favorited, subjectType, subjectId]);

  if (!me) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void toggle().catch(() => undefined)}
      className={`text-xs rounded px-2 py-1 border disabled:opacity-50 ${
        favorited ? 'border-brand text-brand' : 'border-gray-300 text-muted'
      }`}
    >
      {favorited ? t('saved') : t('save')}
    </button>
  );
}
