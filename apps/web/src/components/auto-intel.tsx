import { Link } from '@/i18n/routing';
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

const PERIOD_LABEL: Record<string, string> = {
  week: '/周',
  hour: '/小时',
  day: '/天',
  once: '',
};

const CATEGORY_STAT: Record<string, string> = {
  housing: '中位周租',
  job: '中位时薪',
  market: '中位要价',
  service: '中位报价',
};

function priceLabel(item: PulseFeedItem) {
  if (item.priceCents == null || !item.pricePeriod) return null;
  const p = PERIOD_LABEL[item.pricePeriod] ?? PERIOD_LABEL.once;
  return `$${Math.round(item.priceCents / 100)}${p}`;
}

/** Auto-collected intel block: stats strip + latest items; hides until data exists. */
export async function AutoIntel({ title, category, q, citySlug, limit = 6 }: Props) {
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
          {'查看全部 →'}
        </Link>
      </div>
      {insights && insights.count > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm rounded-xl bg-surface px-4 py-2.5">
          <span className="text-navy font-medium">
            {`近 7 天 ${insights.count} 条`}
          </span>
          {statLabel && insights.medianPriceCents != null && (
            <span className="text-navy font-medium">
              {statLabel} ${Math.round(insights.medianPriceCents / 100)}
              {PERIOD_LABEL[insights.period]}
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
        {'自动采集自中文社区并提取行情数据，每日更新，点击跳原文。'}
      </p>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const price = priceLabel(item);
          return (
            <li key={item.id} className="py-3">
              <Link
                href={`/pulse/${item.id}`}
                className="font-medium text-navy hover:text-brand"
              >
                {item.titleZh ?? item.title}
              </Link>
              <p className="text-sm text-muted mt-1 flex flex-wrap gap-x-2">
                {price && <span className="font-medium text-coral-dark">{price}</span>}
                {item.location && <span>{item.location}</span>}
                <span>
                  {item.sourceName}
                  {' · '}
                  {formatDate(item.publishedAt)}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
