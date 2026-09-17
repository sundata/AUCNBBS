'use client';
import { useEffect, useState } from 'react';
import { api, apiBase } from '@/lib/api';

interface ServedAd {
  id: string;
  title: string;
  body: string | null;
  targetUrl: string;
  imageUrl: string | null;
}

/** Native ad slot (§9.1): one active campaign per placement; clicks are billed server-side. */
export function AdSlot({
  placement,
  cityId,
  label,
}: {
  placement: 'home' | 'search' | 'channel';
  cityId?: string;
  label: string;
}) {
  const [ad, setAd] = useState<ServedAd | null>(null);
  useEffect(() => {
    api<{ ad: ServedAd | null }>(
      `/ads/serve?placement=${placement}${cityId ? `&cityId=${cityId}` : ''}`,
    )
      .then((r) => setAd(r.ad))
      .catch(() => setAd(null));
  }, [placement, cityId]);
  if (!ad) return null;
  return (
    <aside className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <span className="text-[10px] uppercase tracking-wide text-amber-700">{label}</span>
      <a
        href={ad.targetUrl}
        rel="sponsored noopener noreferrer"
        target="_blank"
        className="block mt-1"
        onClick={() => {
          void fetch(`${apiBase()}/api/v1/ads/${ad.id}/click`, {
            method: 'POST',
            credentials: 'include',
          }).catch(() => undefined);
        }}
      >
        {ad.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" className="w-full rounded mb-2 max-h-32 object-cover" />
        )}
        <strong className="text-brand">{ad.title}</strong>
        {ad.body && <p className="text-muted mt-0.5 line-clamp-2">{ad.body}</p>}
      </a>
    </aside>
  );
}
