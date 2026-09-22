import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import type { DailyNote } from '@/components/daily-note-view';
import { DailyCover } from '@/components/daily-cover';
import { sectionMeta } from '@/lib/meta';

export const generateMetadata = sectionMeta('meta.daily', '/daily');
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; city?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const zh = locale === 'zh';
  const q = await searchParams;
  const city = ['melbourne', 'tokyo', 'both'].includes(q.city ?? '') ? q.city! : 'melbourne';
  const page = Math.floor(Math.min(10000, Math.max(1, Number(q.page) || 1)));
  const data = await api<{ items: DailyNote[]; total: number }>(
    `/daily-notes?city=${city}&page=${Math.floor(page)}`,
  );
  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-brand">东京 × 墨尔本 · 华人生活情报</p>
        <h1 className="text-3xl font-semibold mt-2">{zh ? '每日图文' : 'Daily stories'}</h1>
      </div>
      <nav className="flex gap-4">
        {[
          ['melbourne', '墨尔本', 'Melbourne'],
          ['tokyo', '东京', 'Tokyo'],
          ['both', '双城对比', 'Both cities'],
        ].map(([slug, cn, en]) => (
          <Link
            key={slug}
            aria-current={city === slug ? 'page' : undefined}
            className={`rounded-lg border px-4 py-2 ${city === slug ? 'bg-brand text-white' : 'bg-white'}`}
            href={`/daily?city=${slug}`}
          >
            {zh ? cn : en}
          </Link>
        ))}
      </nav>
      {data.items.length === 0 ? (
        <p className="bg-white border rounded-xl p-8 text-muted">
          {zh ? '还没有已发布的图文。新内容接收后会在这里展示。' : 'No published stories yet.'}
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((n) => (
            <Link
              className="bg-white border rounded-2xl overflow-hidden"
              key={n.id}
              href={`/daily/${n.id}`}
            >
              <DailyCover id={n.id} alt={n.imageAlt} />
              <div className="p-5">
                <p className="text-sm text-muted">{n.edition}</p>
                <h2 className="text-xl font-semibold mt-2">{n.title}</h2>
                <p className="text-muted mt-3 line-clamp-3">{n.summary}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
      <nav className="flex justify-between">
        {page > 1 ? (
          <Link href={`/daily?city=${city}&page=${page - 1}`}>{zh ? '上一页' : 'Previous'}</Link>
        ) : (
          <span />
        )}
        {page * 12 < data.total && (
          <Link href={`/daily?city=${city}&page=${page + 1}`}>{zh ? '下一页' : 'Next'}</Link>
        )}
      </nav>
    </section>
  );
}
