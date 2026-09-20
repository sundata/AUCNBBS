import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api, type PulseFeedDetail } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { notFound } from 'next/navigation';

const PERIOD_LABEL: Record<string, { zh: string; en: string }> = {
  week: { zh: '/周', en: '/wk' },
  hour: { zh: '/小时', en: '/hr' },
  day: { zh: '/天', en: '/day' },
  once: { zh: '', en: '' },
};

export default async function PulseItemPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pulse');
  const item = await api<PulseFeedDetail>(`/pulse/feed/${id}`).catch(() => null);
  if (!item) notFound();

  const title = item.titleZh ?? item.title;
  const summary = item.summaryZh ?? item.summary;
  const price =
    item.priceCents != null && item.pricePeriod
      ? `$${Math.round(item.priceCents / 100)}${PERIOD_LABEL[item.pricePeriod].zh}`
      : null;

  return (
    <article className="max-w-2xl mx-auto space-y-5">
      <Link href="/pulse" className="text-sm text-brand">
        {'← 返回澳洲脉搏'}
      </Link>
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="text-brand">{t(`cat.${item.category as 'news'}`)}</span>
          <span>{item.sourceName}</span>
          {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
        </div>
        <h1 className="text-2xl font-semibold text-navy leading-snug">{title}</h1>
        <div className="flex flex-wrap gap-2">
          {price && (
            <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-coral-dark">
              {price}
            </span>
          )}
          {item.location && (
            <span className="rounded-full bg-surface px-3 py-1 text-sm text-muted">
              {item.location}
            </span>
          )}
        </div>
      </header>
      {item.brief && (
        <div className="rounded-2xl border border-brand/20 bg-red-50/40 p-5">
          <p className="text-xs font-medium text-brand mb-2">
            {'AI 导读'}
          </p>
          <p className="text-navy leading-relaxed whitespace-pre-wrap">{item.brief}</p>
        </div>
      )}
      {summary && (
        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-xs font-medium text-muted mb-2">
            {'原文摘要'}
          </p>
          <p className="text-sm text-navy leading-relaxed whitespace-pre-wrap">{summary}</p>
        </div>
      )}
      <div className="rounded-2xl border border-line bg-white p-5 flex items-center justify-between gap-4">
        <p className="text-sm text-muted">
          {`采集自 ${item.sourceName}，原帖含联系方式与更多细节。`}
        </p>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-red-50"
        >
          {'查看原帖 →'}
        </a>
      </div>
      {item.related.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-navy">{'相关情报'}</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {item.related.map((r) => (
              <li key={r.id} className="p-4">
                <Link href={`/pulse/${r.id}`} className="font-medium text-navy hover:text-brand">
                  {r.titleZh ?? r.title}
                </Link>
                <p className="text-sm text-muted mt-1">
                  {r.sourceName}
                  {' · '}
                  {formatDate(r.publishedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
