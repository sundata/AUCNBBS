'use client';

import type { ListingStatus } from '@aucn/domain';
import { canTransition, effectiveListingStatus, isPubliclyVisible } from '@aucn/domain';
import { useTranslations } from 'next-intl';
import { useRouter as useLocaleRouter } from '@/i18n/routing';
import { useState } from 'react';
import { api, ApiError, type ListingDetail } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

const ACTIONS: {
  to: ListingStatus;
  key: 'markCompleted' | 'pause' | 'resume' | 'renew' | 'archive';
}[] = [
  { to: 'completed', key: 'markCompleted' },
  { to: 'paused', key: 'pause' },
  { to: 'active', key: 'resume' },
  { to: 'archived', key: 'archive' },
];

type OwnerActionsProps = {
  listing: Pick<ListingDetail, 'id' | 'status' | 'expiresAt'> & { owner: { id: string } };
  onChanged?: (updated: ListingDetail) => void;
  userId?: string;
};
export function OwnerActions(props: OwnerActionsProps) {
  return props.userId ? <Actions {...props} /> : <ConnectedActions {...props} />;
}
function ConnectedActions(props: OwnerActionsProps) {
  const { me } = useAuth();
  return <Actions {...props} userId={me?.id} />;
}
function Actions({ listing, onChanged, userId }: OwnerActionsProps) {
  const t = useTranslations('listing');
  const tc = useTranslations('common');
  const router = useLocaleRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (userId !== listing.owner.id) return null;

  const status = effectiveListingStatus(listing.status, new Date(listing.expiresAt));
  const expired = status === 'expired';
  const actions = ACTIONS.filter((a) => canTransition(status, a.to)).map((a) =>
    a.to === 'active' && expired ? { ...a, key: 'renew' as const } : a,
  );

  async function run(to: ListingStatus) {
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const updated = await api<ListingDetail>(`/listings/${listing.id}/status`, {
        method: 'POST',
        token,
        body: JSON.stringify({ status: to }),
      });
      if (onChanged) {
        onChanged(updated);
      } else if (!isPubliclyVisible(updated.status, new Date(updated.expiresAt))) {
        router.push('/me');
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t pt-3 space-y-2">
      <div className="text-xs text-muted">{t(`status.${status}`)}</div>
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
