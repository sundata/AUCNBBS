'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, apiBase } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-client';
export function ListingImages({
  listingId,
  readOnly = false,
}: {
  listingId: string;
  readOnly?: boolean;
}) {
  const t = useTranslations('media');
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : t('error')),
    [t],
  );
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void (async () => {
      const token = await getAccessToken();
      const rows = await api<{ id: string }[]>(`/media/listings/${listingId}`, { token });
      const loaded = await Promise.all(
        rows.map(async (row) => {
          const res = await fetch(`${apiBase()}/api/v1/media/${row.id}`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(t('error'));
          const url = URL.createObjectURL(await res.blob());
          urls.push(url);
          return { ...row, url };
        }),
      );
      if (active) setImages(loaded);
      else urls.forEach((url) => URL.revokeObjectURL(url));
    })().catch(fail);
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [listingId, revision, fail, t]);
  if (readOnly && !images.length) return error ? <p role="alert">{error}</p> : null;
  return (
    <section className="bg-white rounded border p-4 space-y-3">
      <h2 className="font-bold">{t('title')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {images.map((image, index) => (
          <div key={image.id}>
            {/* Blob URLs are produced from the authenticated image response. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={t('alt', { index: index + 1 })}
              className="rounded w-full object-contain max-h-64"
            />
            {!readOnly && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void (async () => {
                    await api(`/media/${image.id}`, {
                      method: 'DELETE',
                      token: await getAccessToken(),
                    });
                    setRevision((n) => n + 1);
                  })()
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                {t('remove')}
              </button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <label className="block">
          {t('upload')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || images.length >= 8}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 8 * 1024 * 1024) {
                setError(t('limit'));
                return;
              }
              setBusy(true);
              setError('');
              void (async () => {
                const form = new FormData();
                form.append('file', file);
                const token = await getAccessToken();
                const response = await fetch(`${apiBase()}/api/v1/media/listings/${listingId}`, {
                  method: 'POST',
                  headers: token ? { authorization: `Bearer ${token}` } : {},
                  body: form,
                });
                if (!response.ok) {
                  const problem = await response.json();
                  throw new Error(problem.detail ?? problem.title ?? t('error'));
                }
                setRevision((n) => n + 1);
              })()
                .catch(fail)
                .finally(() => setBusy(false));
            }}
          />
        </label>
      )}
      {!readOnly && <p className="text-sm text-muted">{t('hint')}</p>}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
