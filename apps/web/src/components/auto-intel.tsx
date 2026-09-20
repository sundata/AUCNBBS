import { getLocale } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type PulseFeedItem, type PulseInsights } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { IntelAlert } from '@/components/intel-alert';

interface Props {
  title: string;
  category?: string;
  q?: string;
  citySlug?: string;
  limit?: number;
}

const PERIOD_LABEL: Record<string, { zh: string; en: string }> = {
  week: { zh: '/周', en: '/wk' },
  hour: { zh: '/小时', en: '/hr' },
  day: { zh: '/天', en: '/day' },
  once: { zh: '', en: '' },
};

const CATEGORY_STAT: Record<string, { zh: string; en: string }> = {
  housing: { zh: '中位周租', en: 'median rent' },
  job: { zh: '中位时薪', en: 'median pay' },
  market: { zh: '中位要价', en: 'median price' },
  service: { zh: '中位报价', en: 'median quote' },
};

function priceLabel(item: PulseFeedItem, zh: boolean) {
  if (item.priceCents == null || !item.pricePeriod) return null;
  const p = PERIOD_LABEL[item.pricePeriod] ?? PERIOD_LABEL.once;
  return `$${Math.round(item.priceCents / 100)}${zh ? p.zh : p.en}`;
}

/** Auto-collected intel block: stats strip + latest items; hides until data exists. */
export async function AutoIntel({ title, category, q, citySlug, limit = 6 }: Props) {
  const loc = (await getLocale()) as AppLocale;
  const zh = loc === 'zh';
  const [feed, insights] = await Promise.all([
    api<{ items: PulseFeedItem[] }>(`/pulse/feed${qs({ category, q, city: citySlug })}`).catch(
      () => null,
    ),
    category
      ? api<PulseInsights>(`/pulse/insights${qs({ category })}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const items = feed?.items.slice(0, limit) ?? [];
  if (!items.length) return null;
  const statLabel = category ? CATEGORY_STAT[category] : undefined;
  return (
    <section className="rounded-2xl border border-line bg-white p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-navy">{title}</h2>
        <Link href={`/pulse${qs({ category, q, city: citySlug })}`} className="text-sm text-brand">
          {zh ? '查看全部 →' : 'View all →'}
        </Link>
      </div>
      {insights && insights.count > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm rounded-xl bg-surface px-4 py-2.5">
          <span className="text-navy font-medium">
            {zh ? `近 7 天 ${insights.count} 条` : `${insights.count} posts this week`}
          </span>
          {statLabel && insights.medianPriceCents != null && (
            <span className="text-navy font-medium">
              {zh ? statLabel.zh : statLabel.en} ${Math.round(insights.medianPriceCents / 100)}
              {zh ? PERIOD_LABEL[insights.period].zh : PERIOD_LABEL[insights.period].en}
              {insights.deltaPct != null && (
                <span
                  className={insights.deltaPct > 0 ? 'text-coral-dark' : 'text-brand'}
                >{` ${insights.deltaPct > 0 ? '↑' : '↓'}${Math.abs(insights.deltaPct)}%`}</span>
              )}
            </span>
          )}
          {insights.topLocations.slice(0, 4).map((l) => (
            <span key={l.name} className="text-muted">
              {l.name} {l.count}
            </span>
          ))}
          {statLabel && <IntelAlert category={category as string} label={title} />}
        </div>
      )}
      <p className="text-sm text-muted">
        {zh
          ? '自动采集自中文社区并提取行情数据，每日更新，点击跳原文。'
          : 'Auto-collected from Chinese community sources with extracted price signals — links open the source.'}
      </p>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const price = priceLabel(item, zh);
          return (
            <li key={item.id} className="py-3">
              <Link
                href={`/pulse/${item.id}`}
                className="font-medium text-navy hover:text-brand"
              >
                {zh ? (item.titleZh ?? item.title) : item.title}
              </Link>
              <p className="text-sm text-muted mt-1 flex flex-wrap gap-x-2">
                {price && <span className="font-medium text-coral-dark">{price}</span>}
                {item.location && <span>{item.location}</span>}
                <span>
                  {item.sourceName}
                  {' · '}
                  {formatDate(item.publishedAt, loc)}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
