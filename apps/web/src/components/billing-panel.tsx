'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api, type Page, type ListingSummary } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { Link } from '@/i18n/routing';
interface Payment {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  listing: { title: string };
}
export function BillingPanel() {
  const t = useTranslations('billing');
  const locale = useLocale();
  const { me, loading } = useAuth();
  const [product, setProduct] = useState<{ available: boolean; amountMinor?: number }>();
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [refundId, setRefundId] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!me) return;
    let active = true;
    void (async () => {
      const token = await getAccessToken();
      const [product, orders] = await Promise.all([
        api<{ available: boolean; amountMinor?: number }>('/billing/product'),
        api<Payment[]>('/billing/payments', { token }),
      ]);
      const rows: ListingSummary[] = [];
      let cursor: string | null = null;
      do {
        const page: Page<ListingSummary> = await api<Page<ListingSummary>>(
          `/listings/mine?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          { token },
        );
        rows.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && active);
      if (active) {
        setProduct(product);
        setPayments(orders);
        setListings(
          rows.filter(
            (l) => ['active', 'reserved'].includes(l.status) && new Date(l.expiresAt) > new Date(),
          ),
        );
      }
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : t('error'));
    });
    return () => {
      active = false;
    };
  }, [me, t]);
  if (loading) return <p>{t('loading')}</p>;
  if (!me) return <Link href="/login?next=/billing">{t('login')}</Link>;
  return (
    <section className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p>{t('description')}</p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {product?.available ? (
        <form
          className="bg-white border rounded p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const id = requestId || crypto.randomUUID();
            setRequestId(id);
            void (async () => {
              const result = await api<{ url: string }>('/billing/checkout', {
                method: 'POST',
                token: await getAccessToken(),
                body: JSON.stringify({ listingId: selected, requestId: id, locale }),
              });
              window.location.assign(result.url);
            })()
              .catch((e) => {
                setError(e instanceof Error ? e.message : t('error'));
                setRequestId('');
              })
              .finally(() => setBusy(false));
          }}
        >
          <p>{t('price', { price: ((product.amountMinor ?? 0) / 100).toFixed(2) })}</p>
          <label>
            {t('listing')}
            <select
              required
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setRequestId('');
              }}
              className="block border w-full p-2"
            >
              <option value="">{t('choose')}</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy} className="bg-brand text-white rounded px-4 py-2">
            {t('checkout')}
          </button>
        </form>
      ) : (
        <p>{t('unavailable')}</p>
      )}
      <h2 className="font-bold">{t('history')}</h2>
      <p className="text-sm text-muted">{t('pendingHint')}</p>
      {payments.map((p) => (
        <article className="bg-white border rounded p-3" key={p.id}>
          <p>
            {p.listing.title} · A${(p.amountMinor / 100).toFixed(2)} · {t(p.status)}
          </p>
          <code className="text-xs">{p.id}</code>
        </article>
      ))}
      {['admin', 'super_admin'].includes(me.role) && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void (async () => {
              await api('/billing/refund', {
                method: 'POST',
                token: await getAccessToken(),
                body: JSON.stringify({ paymentId: refundId, reason }),
              });
              setRefundId('');
              setReason('');
            })()
              .catch((e) => setError(e instanceof Error ? e.message : t('error')))
              .finally(() => setBusy(false));
          }}
        >
          <h2>{t('refund')}</h2>
          <label>
            {t('paymentId')}
            <input
              required
              value={refundId}
              onChange={(e) => setRefundId(e.target.value)}
              className="border w-full p-2"
            />
          </label>
          <label>
            {t('reason')}
            <input
              required
              minLength={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="border w-full p-2"
            />
          </label>
          <button disabled={busy}>{t('refund')}</button>
        </form>
      )}
    </section>
  );
}
