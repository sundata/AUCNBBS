import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { AppLocale } from '@/i18n/routing';
import { api, ApiError, type ArticleDetail } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ReportButton } from '@/components/report-button';

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  let a: ArticleDetail;
  try {
    a = await api<ArticleDetail>(`/articles/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.problem.status === 404) notFound();
    throw e;
  }
  const t = await getTranslations('news');
  const loc = (await getLocale()) as AppLocale;
  return (
    <article className="bg-white rounded-lg border border-gray-200 p-6 max-w-3xl mx-auto">
      <div className="text-xs text-muted flex gap-2">
        <span className="text-brand">{t(`category.${a.category as 'platform'}`)}</span>
        <span>{formatDate(a.publishedAt, loc)}</span>
        <span>{a.author.displayName}</span>
      </div>
      <h1 className="text-2xl font-bold mt-2 mb-4">{a.title}</h1>
      <p className="text-muted mb-4">{a.summary}</p>
      <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-7">{a.body}</div>
      {a.source && (
        <p className="text-xs text-muted mt-6">
          {t('source')}: {a.source}
        </p>
      )}
      <p className="text-xs text-muted mt-2 border-t pt-3">{t('editorNote')}</p>
      <div className="mt-3">
        <ReportButton subjectType="article" subjectId={a.id} />
      </div>
    </article>
  );
}
