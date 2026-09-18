'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, qs } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-client';

interface Source {
  id: string;
  name: string;
  url: string;
  format: string;
  category: string;
  autoPublish: boolean;
  enabled: boolean;
  intervalMinutes: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  failures: number;
  lastCount: number;
}
interface Item {
  id: string;
  category: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  riskFlags: string[];
  status: string;
  updatedAt: string;
}

export function PulseAdmin() {
  const t = useTranslations('admin.pulse');
  const [sources, setSources] = useState<Source[]>([]);
  const [collectorOn, setCollectorOn] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<'pending' | 'published' | 'rejected'>('pending');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = await getAccessToken();
    const [s, i] = await Promise.all([
      api<{ enabled: boolean; items: Source[] }>('/pulse/admin/sources', { token }),
      api<{ items: Item[] }>(`/pulse/admin/items${qs({ status })}`, { token }),
    ]);
    setCollectorOn(s.enabled);
    setSources(s.items);
    setItems(i.items);
  }, [status]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [load]);

  async function toggleSource(s: Source) {
    setBusy(s.id);
    try {
      await api(`/pulse/admin/sources/${s.id}`, {
        method: 'PATCH',
        token: await getAccessToken(),
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy('');
    }
  }

  async function review(item: Item, next: 'published' | 'rejected') {
    setBusy(item.id);
    try {
      await api(`/pulse/admin/items/${item.id}`, {
        method: 'PATCH',
        token: await getAccessToken(),
        body: JSON.stringify({
          title: item.title,
          summary: item.summary,
          status: next,
          updatedAt: item.updatedAt,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      {error && <p className="text-sm text-coral-dark">{error}</p>}
      {!collectorOn && <p className="text-sm text-muted">{t('collectorOff')}</p>}

      <h3 className="font-medium text-sm text-muted">{t('sources')}</h3>
      {sources.length === 0 ? (
        <p className="text-sm text-muted">{t('noSources')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {sources.map((s) => (
            <li key={s.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {s.name}{' '}
                  <span className="text-xs text-muted">
                    {s.format} · {s.category} · {s.intervalMinutes}m
                    {s.autoPublish ? ` · ${t('auto')}` : ''}
                  </span>
                </div>
                {s.lastError && (
                  <div className="text-xs text-coral-dark truncate">{s.lastError}</div>
                )}
              </div>
              <button
                disabled={busy === s.id}
                onClick={() => void toggleSource(s)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs border ${s.enabled ? 'border-brand text-brand' : 'border-line text-muted'}`}
              >
                {s.enabled ? t('enabled') : t('disabled')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-muted">{t('queue')}</h3>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'pending')}
          className="text-sm border border-line rounded px-2 py-1"
        >
          {(['pending', 'published', 'rejected'] as const).map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {items.map((item) => (
            <li key={item.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:text-brand"
                  >
                    {item.title}
                  </a>
                  <div className="text-xs text-muted">
                    {item.sourceName} · {item.category}
                    {item.riskFlags.length > 0 && (
                      <span className="text-coral-dark"> · ⚠ {item.riskFlags.join(',')}</span>
                    )}
                  </div>
                  {item.summary && <p className="mt-1 text-muted line-clamp-2">{item.summary}</p>}
                </div>
                {item.status === 'pending' && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      disabled={busy === item.id}
                      onClick={() => void review(item, 'published')}
                      className="rounded bg-brand text-white px-3 py-1 text-xs disabled:opacity-40"
                    >
                      {t('publish')}
                    </button>
                    <button
                      disabled={busy === item.id}
                      onClick={() => void review(item, 'rejected')}
                      className="rounded border border-line px-3 py-1 text-xs"
                    >
                      {t('reject')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
