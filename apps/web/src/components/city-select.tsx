'use client';

import {  useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { CityDto } from '@/lib/api';
import { cityName } from '@/lib/format';

export function CitySelect({ cities }: { cities: CityDto[] }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get('city') ?? '';

  return (
    <select
      aria-label={t('allCities')}
      value={current}
      onChange={(e) => {
        const sp = new URLSearchParams(params.toString());
        if (e.target.value) sp.set('city', e.target.value);
        else sp.delete('city');
        sp.delete('cursor');
        router.push(`${pathname}${sp.toString() ? `?${sp}` : ''}`);
      }}
      className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
    >
      <option value="">{t('allCities')}</option>
      {cities.map((c) => (
        <option key={c.id} value={c.slug}>
          {cityName(c)}
        </option>
      ))}
    </select>
  );
}
