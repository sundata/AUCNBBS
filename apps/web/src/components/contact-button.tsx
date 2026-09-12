'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
export function ContactButton({ listingId, ownerId }: { listingId: string; ownerId: string }) {
  const t = useTranslations('messages');
  const { me } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (me?.id === ownerId) return null;
  return (
    <div>
      <button
        disabled={busy}
        className="my-3 bg-brand text-white rounded px-3 py-2"
        onClick={() => {
          if (!me) {
            router.push('/login?next=/messages');
            return;
          }
          setBusy(true);
          void (async () => {
            const token = await getAccessToken();
            const c = await api<{ id: string }>('/messages/conversations', {
              method: 'POST',
              token,
              body: JSON.stringify({ listingId }),
            });
            router.push(`/messages?conversation=${c.id}`);
          })()
            .catch((e) => setError(e instanceof Error ? e.message : t('error')))
            .finally(() => setBusy(false));
        }}
      >
        {t('contact')}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
