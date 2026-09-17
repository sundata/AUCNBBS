'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, useRouter, type AppLocale } from '@/i18n/routing';
import { api, ApiError, type CityDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { cityName } from '@/lib/format';

const INTERESTS = [
  'housing',
  'jobs',
  'market',
  'services',
  'community',
  'news',
  'events',
  'businesses',
] as const;

export function OnboardingForm() {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { me, loading } = useAuth();
  const [cities, setCities] = useState<CityDto[]>([]);
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [cityId, setCityId] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<CityDto[]>('/cities')
      .then(setCities)
      .catch(() => setCities([]));
  }, []);
  useEffect(() => {
    if (me) {
      setName(me.displayName);
      setBirthYear(me.birthYear ? String(me.birthYear) : '');
      setCityId(me.homeCityId ?? '');
      setInterests(me.interests);
    }
  }, [me]);

  if (loading) return <p className="text-sm text-muted">{tc('loading')}</p>;
  if (!me)
    return (
      <p className="text-sm">
        <Link href="/login?next=/onboarding" className="text-brand underline">
          {t('login')}
        </Link>
      </p>
    );

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api('/me', {
        method: 'PATCH',
        token: await getAccessToken(),
        body: JSON.stringify({
          displayName: name || undefined,
          birthYear: birthYear ? Number(birthYear) : undefined,
          homeCityId: cityId || null,
          interests,
          onboarded: true,
        }),
      });
      window.dispatchEvent(new Event('aucn-auth'));
      router.push('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted mt-1">{t('subtitle')}</p>
      </div>
      <label className="block text-sm">
        <span className="text-muted">{t('name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={40}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-muted">{t('birthYear')}</span>
        <input
          type="number"
          inputMode="numeric"
          min={1900}
          max={new Date().getFullYear()}
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
          placeholder="1990"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
        <span className="text-xs text-muted">{t('birthYearHint')}</span>
      </label>
      <label className="block text-sm">
        <span className="text-muted">{t('city')}</span>
        <select
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        >
          <option value="">{t('skipCity')}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {cityName(c, locale)}
            </option>
          ))}
        </select>
      </label>
      <div>
        <div className="text-sm text-muted mb-2">{t('interests')}</div>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((key) => {
            const active = interests.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setInterests((list) => (active ? list.filter((i) => i !== key) : [...list, key]))
                }
                className={`text-sm rounded-full px-3 py-1 border ${
                  active ? 'bg-brand text-white border-brand' : 'border-gray-300 text-muted'
                }`}
              >
                {t(`interest.${key}`)}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void finish()}
          className="rounded bg-brand text-white px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('finish')}
        </button>
        <button type="button" onClick={() => router.push('/')} className="text-sm text-muted">
          {t('skip')}
        </button>
      </div>
    </div>
  );
}
