'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, type BusinessLeadDto, type Page } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

/** Visitor lead form (§5.6 线索收件箱入口). */
export function LeadForm({ businessId }: { businessId: string }) {
  const t = useTranslations('businesses');
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (sent) return <p className="text-sm text-green-700">{t('leadSent')}</p>;
  if (!open)
    return (
      <button className="text-sm text-brand underline" onClick={() => setOpen(true)}>
        {t('contactBusiness')}
      </button>
    );
  return (
    <form
      className="space-y-2 text-sm border rounded p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        void (async () => {
          await api(`/businesses/${businessId}/leads`, {
            method: 'POST',
            token: me ? await getAccessToken() : undefined,
            body: JSON.stringify({
              name: f.get('name'),
              contact: f.get('contact'),
              message: f.get('message'),
            }),
          });
          setSent(true);
        })()
          .catch((err) => setError(err instanceof Error ? err.message : t('error')))
          .finally(() => setBusy(false));
      }}
    >
      <input
        name="name"
        required
        maxLength={80}
        placeholder={t('leadName')}
        className="block w-full border rounded px-2 py-1"
      />
      <input
        name="contact"
        required
        maxLength={120}
        placeholder={t('leadContact')}
        className="block w-full border rounded px-2 py-1"
      />
      <textarea
        name="message"
        required
        maxLength={1000}
        placeholder={t('leadMessage')}
        className="block w-full border rounded px-2 py-1 h-20"
      />
      {error && <p className="text-red-600">{error}</p>}
      <button disabled={busy} className="bg-brand text-white rounded px-3 py-1 disabled:opacity-50">
        {t('send')}
      </button>
    </form>
  );
}

/** Owner view: leads inbox + CSV export link. */
export function LeadsInbox({ businessId }: { businessId: string }) {
  const t = useTranslations('businesses');
  const [leads, setLeads] = useState<BusinessLeadDto[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const load = () =>
    void (async () => {
      const page = await api<Page<BusinessLeadDto>>(`/businesses/${businessId}/leads`, {
        token: await getAccessToken(),
      });
      setLeads(page.items);
    })().catch((e) => setError(e instanceof Error ? e.message : t('error')));
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-2">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">{t('leadsTitle')}</h2>
        {!open && (
          <button
            className="text-sm text-brand underline"
            onClick={() => {
              setOpen(true);
              load();
            }}
          >
            {t('viewLeads')}
          </button>
        )}
        <a
          className="text-xs text-muted underline"
          href={`/api/v1/businesses/${businessId}/leads.csv`}
          onClick={async (e) => {
            e.preventDefault();
            const res = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/businesses/${businessId}/leads.csv`,
              { headers: { authorization: `Bearer ${await getAccessToken()}` } },
            );
            if (!res.ok) return;
            const url = URL.createObjectURL(await res.blob());
            const a = document.createElement('a');
            a.href = url;
            a.download = 'leads.csv';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          {t('exportCsv')}
        </a>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {open &&
        (leads === null ? (
          <p className="text-sm text-muted">…</p>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted">{t('noLeads')}</p>
        ) : (
          <ul className="divide-y text-sm">
            {leads.map((l) => (
              <li key={l.id} className="py-2">
                <div className="flex justify-between">
                  <strong>{l.name}</strong>
                  <span className="text-xs text-muted">
                    {l.status} · {new Date(l.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-muted">{l.contact}</p>
                <p>{l.message}</p>
                {l.status === 'new' && (
                  <button
                    className="text-xs text-brand underline"
                    onClick={() =>
                      void (async () => {
                        await api(`/businesses/${businessId}/leads/${l.id}`, {
                          method: 'PATCH',
                          token: await getAccessToken(),
                          body: JSON.stringify({ status: 'replied' }),
                        });
                        setLeads(
                          (rows) =>
                            rows?.map((r) => (r.id === l.id ? { ...r, status: 'replied' } : r)) ??
                            rows,
                        );
                      })().catch(() => undefined)
                    }
                  >
                    {t('markContacted')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
