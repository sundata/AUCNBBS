import { getLocale } from 'next-intl/server';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, qs, type PulseFeedItem } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Props {
  title: string;
  category?: string;
  q?: string;
  citySlug?: string;
  limit?: number;
}

/** Auto-collected intel block: renders nothing until the pipeline has data. */
export async function AutoIntel({ title, category, q, citySlug, limit = 6 }: Props) {
  const loc = (await getLocale()) as AppLocale;
  const feed = await api<{ items: PulseFeedItem[] }>(
    `/pulse/feed${qs({ category, q, city: citySlug })}`,
  ).catch(() => null);
  const items = feed?.items.slice(0, limit) ?? [];
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-white p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-navy">{title}</h2>
        <Link href={`/pulse${qs({ category, q, city: citySlug })}`} className="text-sm text-brand">
          {loc === 'zh' ? '查看全部 →' : 'View all →'}
        </Link>
      </div>
      <p className="text-sm text-muted">
        {loc === 'zh'
          ? '自动采集自本地媒体，每日更新，点击跳原文。'
          : 'Auto-collected from local media, updated daily — links open the source.'}
      </p>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="py-3">
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-navy hover:text-brand"
            >
              {loc === 'zh' ? (item.titleZh ?? item.title) : item.title}
            </a>
            <p className="text-sm text-muted mt-1">
              {item.sourceName}
              {' · '}
              {formatDate(item.publishedAt, loc)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
