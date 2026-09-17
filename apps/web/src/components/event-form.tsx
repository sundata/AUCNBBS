'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { EVENT_CATEGORIES, eventSchema } from '@aucn/domain';
import { z } from 'zod';
import { Link, useRouter, type AppLocale } from '@/i18n/routing';
import { api, ApiError, type CityDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { cityName } from '@/lib/format';

export function EventForm() {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const ta = useTranslations('auth');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { me, loading } = useAuth();
  const [cities, setCities] = useState<CityDto[]>([]);
  const [form, setForm] = useState({
    title: '',
    body: '',
    category: 'community',
    cityId: '',
    venue: '',
    online: false,
    startsAt: '',
    endsAt: '',
    capacity: '',
    price: '',
    externalUrl: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<CityDto[]>('/cities')
      .then(setCities)
      .catch(() => setCities([]));
  }, []);

  if (loading) return <p className="text-sm text-muted">{tc('loading')}</p>;
  if (!me)
    return (
      <p className="text-sm">
        {ta('required')}{' '}
        <Link href="/login?next=/events/new" className="text-brand underline">
          {ta('title')}
        </Link>
      </p>
    );

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({
        ...f,
        [key]:
          e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value,
      }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: form.title,
        body: form.body,
        category: form.category,
        cityId: form.cityId,
        venue: form.venue || undefined,
        online: form.online,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : '',
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : '',
        capacity: form.capacity ? Number(form.capacity) : undefined,
        priceMinor: form.price ? Math.round(Number(form.price) * 100) : undefined,
        externalUrl: form.externalUrl || undefined,
      };
      const parsed = eventSchema.safeParse(payload);
      if (!parsed.success) {
        const fields = Object.keys((parsed.error as z.ZodError).flatten().fieldErrors);
        setError(`${tc('error')} ${fields.join(', ')}`);
        setBusy(false);
        return;
      }
      const e = await api<{ id: string }>('/events', {
        method: 'POST',
        token: await getAccessToken(),
        body: JSON.stringify(parsed.data),
      });
      router.push(`/events/${e.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h1 className="text-xl font-bold">{t('addTitle')}</h1>
      <label className="block text-sm">
        <span className="text-muted">{t('form.title')}</span>
        <input
          value={form.title}
          onChange={set('title')}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-muted">{t('form.body')}</span>
        <textarea
          rows={5}
          value={form.body}
          onChange={set('body')}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      </label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="text-muted">{t('form.category')}</span>
          <select
            value={form.category}
            onChange={set('category')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          >
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">{t('form.city')}</span>
          <select
            value={form.cityId}
            onChange={set('cityId')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">—</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {cityName(c, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.online} onChange={set('online')} />
          {t('online')}
        </label>
        {!form.online && (
          <label className="block text-sm">
            <span className="text-muted">{t('form.venue')}</span>
            <input
              value={form.venue}
              onChange={set('venue')}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-muted">{t('form.startsAt')}</span>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={set('startsAt')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{t('form.endsAt')}</span>
          <input
            type="datetime-local"
            value={form.endsAt}
            onChange={set('endsAt')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{t('form.capacity')}</span>
          <input
            type="number"
            min={1}
            value={form.capacity}
            onChange={set('capacity')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">{t('form.price')}</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={set('price')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">{t('form.externalUrl')}</span>
          <input
            type="url"
            value={form.externalUrl}
            onChange={set('externalUrl')}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="rounded bg-brand text-white px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {t('submit')}
      </button>
    </div>
  );
}
