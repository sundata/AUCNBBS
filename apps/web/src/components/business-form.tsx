'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter, type AppLocale } from '@/i18n/routing';
import { BUSINESS_CATEGORIES, businessSchema } from '@aucn/domain';
import { api, ApiError, type CityDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { cityName } from '@/lib/format';
import { Link } from '@/i18n/routing';
import { z } from 'zod';

export function BusinessForm() {
  const t = useTranslations('businesses');
  const tc = useTranslations('common');
  const ta = useTranslations('auth');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { me, loading } = useAuth();
  const [cities, setCities] = useState<CityDto[]>([]);
  const [form, setForm] = useState({
    nameZh: '',
    nameEn: '',
    category: 'restaurant',
    descriptionZh: '',
    suburb: '',
    address: '',
    cityId: '',
    phone: '',
    website: '',
    abn: '',
    openingHours: '',
    priceRange: '',
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
        <Link href="/login?next=/businesses/new" className="text-brand underline">
          {ta('title')}
        </Link>
      </p>
    );

  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...form,
        nameEn: form.nameEn || undefined,
        address: form.address || undefined,
        cityId: form.cityId || undefined,
        phone: form.phone || undefined,
        website: form.website || undefined,
        abn: form.abn || undefined,
        openingHours: form.openingHours || undefined,
        priceRange: form.priceRange || undefined,
      };
      const parsed = businessSchema.safeParse(payload);
      if (!parsed.success) {
        const fields = Object.keys((parsed.error as z.ZodError).flatten().fieldErrors);
        setError(`${tc('error')} ${fields.join(', ')}`);
        setBusy(false);
        return;
      }
      const b = await api<{ id: string }>('/businesses', {
        method: 'POST',
        token: await getAccessToken(),
        body: JSON.stringify(parsed.data),
      });
      router.push(`/businesses/${b.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
      setBusy(false);
    }
  }

  const field = (
    key: keyof typeof form,
    label: string,
    opts: { textarea?: boolean; required?: boolean } = {},
  ) => (
    <label className="block text-sm">
      <span className="text-muted">
        {label}
        {opts.required ? '' : ` (${tc('optional')})`}
      </span>
      {opts.textarea ? (
        <textarea
          rows={4}
          value={form[key]}
          onChange={(e) => set(key)(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      ) : (
        <input
          value={form[key]}
          onChange={(e) => set(key)(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      )}
    </label>
  );

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h1 className="text-xl font-bold">{t('addTitle')}</h1>
      {field('nameZh', t('form.nameZh'), { required: true })}
      {field('nameEn', t('form.nameEn'))}
      <label className="block text-sm">
        <span className="text-muted">{t('form.category')}</span>
        <select
          value={form.category}
          onChange={(e) => set('category')(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        >
          {BUSINESS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
      </label>
      {field('descriptionZh', t('form.description'), { textarea: true })}
      <div className="grid sm:grid-cols-2 gap-4">
        {field('suburb', t('form.suburb'), { required: true })}
        <label className="block text-sm">
          <span className="text-muted">{t('form.city')}</span>
          <select
            value={form.cityId}
            onChange={(e) => set('cityId')(e.target.value)}
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
        {field('address', t('form.address'))}
        {field('phone', t('form.phone'))}
        {field('website', t('form.website'))}
        {field('abn', 'ABN')}
        {field('openingHours', t('form.hours'))}
        {field('priceRange', t('form.priceRange'))}
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
