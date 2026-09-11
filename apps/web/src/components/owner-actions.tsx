'use client';

import type { ListingStatus } from '@aucn/domain';
import { canTransition } from '@aucn/domain';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, type ListingDetail } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

const ACTIONS: { to: ListingStatus; key: 'markCompleted' | 'pause' | 'resume' | 'renew' }[] = [
  { to: 'completed', key: 'markCompleted' },
  { to: 'paused', key: 'pause' },
  { to: 'active', key: 'resume' },
];

export function OwnerActions({ listing }: { listing: ListingDetail }) {
  const { me } = useAuth();
  const t = useTranslations('listing');
  const tc = useTranslations('common');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me || me.id !== listing.owner.id) return null;

  const expired = new Date(listing.expiresAt) <= new Date() || listing.status === 'expired';
  const actions = ACTIONS.filter((a) => canTransition(listing.status, a.to)).map((a) =>
    a.to === 'active' && expired ? { ...a, key: 'renew' as const } : a,
  );

  async function run(to: ListingStatus) {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      await api(`/listings/${listing.id}/status`, {
        method: 'POST',
        token,
        body: JSON.stringify({ status: to }),
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t pt-3 space-y-2">
      <div className="text-xs text-muted">{t(`status.${listing.status}`)}</div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.to}
            type="button"
            disabled={busy}
            onClick={() => void run(a.to)}
            className={`text-xs rounded px-2 py-1 border ${a.to === 'completed' ? 'bg-brand text-white border-brand' : 'border-gray-300'} disabled:opacity-50`}
          >
            {t(a.key)}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
