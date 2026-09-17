'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { Link } from '@/i18n/routing';

/** §5.9 phone_on_request: reveal requires sign-in and is audit-logged server-side. */
export function PhoneReveal({ listingId }: { listingId: string }) {
  const t = useTranslations('listings');
  const { me, loading } = useAuth();
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading) return null;
  if (!me)
    return (
      <Link href={`/login?next=/listings`} className="text-sm text-brand underline">
        {t('phoneLogin')}
      </Link>
    );
  if (phone)
    return (
      <p className="text-sm font-medium mt-1">
        <a href={`tel:${phone}`} className="text-brand">
          {phone}
        </a>
      </p>
    );
  return (
    <div>
      <button
        disabled={busy}
        className="text-sm text-brand underline disabled:opacity-50"
        onClick={() => {
          setBusy(true);
          void (async () => {
            const r = await api<{ phone: string }>(`/listings/${listingId}/phone`, {
              method: 'POST',
              token: await getAccessToken(),
            });
            setPhone(r.phone);
          })()
            .catch((e) => setError(e instanceof Error ? e.message : t('phoneError')))
            .finally(() => setBusy(false));
        }}
      >
        {t('revealPhone')}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
