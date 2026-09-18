import { getLocale, getTranslations } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs } from '@/lib/api';
import type { PulseDashboard as Dash } from '@/lib/api';
import { cityName } from '@/lib/format';

const WMO: Record<number, [string, string]> = {
  0: ['晴', 'Clear'],
  1: ['晴间多云', 'Mostly clear'],
  2: ['多云', 'Partly cloudy'],
  3: ['阴', 'Overcast'],
  45: ['雾', 'Fog'],
  48: ['雾凇', 'Rime fog'],
  51: ['毛毛雨', 'Drizzle'],
  61: ['小雨', 'Light rain'],
  63: ['中雨', 'Rain'],
  65: ['大雨', 'Heavy rain'],
  71: ['小雪', 'Light snow'],
  80: ['阵雨', 'Showers'],
  95: ['雷暴', 'Thunderstorm'],
};

function wmoText(code: number | undefined, loc: AppLocale) {
  const v = code == null ? undefined : (WMO[code] ?? ['—', '—']);
  return v ? (loc === 'zh' ? v[0] : v[1]) : '—';
}

export async function PulseDashboard({ citySlug }: { citySlug?: string }) {
  const [t, loc] = await Promise.all([getTranslations('pulse'), getLocale() as Promise<AppLocale>]);
  const d = await api<Dash>(`/pulse/dashboard${qs({ city: citySlug })}`).catch(() => null);
  if (!d) return null;
  const rate = d.metrics.find((m) => m.kind === 'exchange_rate');
  const weather = d.metrics.filter((m) => m.kind === 'weather');
  const fuel = d.metrics.find((m) => m.kind === 'fuel');
  const rates = (rate?.payload as { rates?: Record<string, number> } | undefined)?.rates ?? {};
  const hasAny = rate || weather.length || fuel || d.alerts.length || d.events.length;
  if (!hasAny) return null;

  return (
    <section aria-label={t('today')} className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-navy">{t('today')}</h2>
        <Link href="/pulse" className="text-sm text-brand">
          {t('all')}
        </Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {rates.CNY != null && (
          <div className="rounded-xl bg-surface px-4 py-3">
            <div className="text-xs text-muted">{t('rate')}</div>
            <div className="mt-1 text-xl font-semibold text-navy">
              1 AUD = {rates.CNY} <span className="text-sm font-normal">CNY</span>
            </div>
          </div>
        )}
        {weather.slice(0, 1).map((w, i) => {
          const p = w.payload as {
            current?: { temp?: number; code?: number };
            daily?: { max?: number; min?: number; rainChance?: number | null }[];
          };
          return (
            <div key={i} className="rounded-xl bg-surface px-4 py-3">
              <div className="text-xs text-muted">
                {d.city ? cityName(d.city, loc) : t('weather')}
              </div>
              <div className="mt-1 text-xl font-semibold text-navy">
                {p.current?.temp ?? '—'}°C{' '}
                <span className="text-sm font-normal">{wmoText(p.current?.code, loc)}</span>
              </div>
              {p.daily?.[0] && (
                <div className="text-xs text-muted">
                  {p.daily[0].min}° ~ {p.daily[0].max}°
                  {p.daily[0].rainChance != null && ` · ${t('rain')} ${p.daily[0].rainChance}%`}
                </div>
              )}
            </div>
          );
        })}
        {fuel && (
          <div className="rounded-xl bg-surface px-4 py-3">
            <div className="text-xs text-muted">{t('fuel')}</div>
            <ul className="mt-1 space-y-0.5 text-sm">
              {((fuel.payload as { stations?: { name: string; price: number }[] }).stations ?? [])
                .slice(0, 3)
                .map((s, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">{s.name}</span>
                    <span className="font-medium text-navy shrink-0">{s.price}¢</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
      {d.alerts.length > 0 && (
        <ul className="mt-3 space-y-1">
          {d.alerts.map((a) => (
            <li key={a.id}>
              <a
                href={a.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-coral-dark hover:underline"
              >
                ⚠ {a.title}
              </a>
            </li>
          ))}
        </ul>
      )}
      {d.events.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-xs text-muted mb-1">{t('upcoming')}</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {d.events.map((e) => (
              <li key={e.id}>
                <Link href="/weekend" className="hover:text-brand">
                  {e.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
