'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';
import { api, ApiError, type FavoriteDto, type Page, type SavedSearchDto, qs } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { LISTING_ROUTES } from '@/lib/format';

function favoriteHref(f: FavoriteDto): string | null {
  if (f.subjectType === 'listing' && f.subjectMeta)
    return `/${LISTING_ROUTES[f.subjectMeta as keyof typeof LISTING_ROUTES]}/${f.subjectId}`;
  if (f.subjectType === 'post') return `/community/posts/${f.subjectId}`;
  if (f.subjectType === 'business') return `/businesses/${f.subjectId}`;
  if (f.subjectType === 'event') return `/events/${f.subjectId}`;
  return null;
}

export function FavoritesPanel() {
  const t = useTranslations('me');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteDto[] | null>(null);
  const [favNext, setFavNext] = useState<string | null>(null);
  const [searches, setSearches] = useState<SavedSearchDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    const [fav, saved] = await Promise.all([
      api<Page<FavoriteDto>>('/me/favorites', { token }),
      api<{ items: SavedSearchDto[] }>('/me/saved-searches', { token }),
    ]);
    setFavorites(fav.items);
    setFavNext(fav.nextCursor);
    setSearches(saved.items);
  }, []);

  useEffect(() => {
    if (me) void load().catch(() => setError(tc('error')));
  }, [me, load, tc]);

  if (!me || favorites === null) return null;

  async function removeFavorite(f: FavoriteDto) {
    setBusy(true);
    try {
      await api(`/me/favorites/${f.subjectType}/${f.subjectId}`, {
        method: 'DELETE',
        token: await getAccessToken(),
      });
      setFavorites((rows) => rows?.filter((r) => r.id !== f.id) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  async function removeSearch(id: string) {
    setBusy(true);
    try {
      await api(`/me/saved-searches/${id}`, {
        method: 'DELETE',
        token: await getAccessToken(),
      });
      setSearches((rows) => rows.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div>
        <h2 className="font-semibold mb-2">{t('favorites')}</h2>
        {favorites.length === 0 ? (
          <p className="text-sm text-muted">{t('noFavorites')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {favorites.map((f) => {
              const href = favoriteHref(f);
              return (
                <li key={f.id} className="py-2 flex items-center gap-3">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100">
                    {t(`favType.${f.subjectType}`)}
                  </span>
                  {href ? (
                    <Link href={href} className="flex-1 line-clamp-1 hover:text-brand">
                      {f.title ?? f.subjectId}
                    </Link>
                  ) : (
                    <span className="flex-1 line-clamp-1">{f.title ?? f.subjectId}</span>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeFavorite(f)}
                    className="text-xs text-red-600 underline disabled:opacity-50"
                  >
                    {tc('close')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {favNext && (
          <button
            disabled={busy}
            className="mt-2 text-brand underline text-sm"
            onClick={() =>
              void (async () => {
                const page = await api<Page<FavoriteDto>>(
                  `/me/favorites${qs({ cursor: favNext })}`,
                  { token: await getAccessToken() },
                );
                setFavorites((rows) => [...(rows ?? []), ...page.items]);
                setFavNext(page.nextCursor);
              })().catch(() => setError(tc('error')))
            }
          >
            {t('loadMore')}
          </button>
        )}
      </div>
      <div className="border-t pt-4">
        <h2 className="font-semibold mb-2">{t('savedSearches')}</h2>
        {searches.length === 0 ? (
          <p className="text-sm text-muted">{t('noSavedSearches')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {searches.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-3">
                <Link
                  href={`/search?q=${encodeURIComponent(s.query)}`}
                  className="flex-1 line-clamp-1 hover:text-brand"
                >
                  {s.name} <span className="text-muted">“{s.query}”</span>
                </Link>
                <span className="text-xs text-muted">{t(`cadence.${s.cadence}`)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeSearch(s.id)}
                  className="text-xs text-red-600 underline disabled:opacity-50"
                >
                  {tc('close')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted mt-2">{t('savedSearchHint')}</p>
      </div>
    </section>
  );
}
