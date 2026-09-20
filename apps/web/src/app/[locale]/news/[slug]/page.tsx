import type { Metadata } from 'next';
import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { api, ApiError, type ArticleDetail } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { localeAlternates } from '@/lib/site';
import { ReportButton } from '@/components/report-button';
import { FavoriteButton } from '@/components/favorite-button';
import { ArticleBody } from '@/components/article-body';

async function loadArticle(slug: string): Promise<ArticleDetail | null> {
  try {
    return await api<ArticleDetail>(`/articles/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.problem.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = await loadArticle(slug);
  if (!a) return {};
  return {
    title: a.title,
    description: a.summary,
    alternates: localeAlternates(`/news/${a.slug}`),
    openGraph: { type: 'article', publishedTime: a.publishedAt ?? undefined },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const a = await loadArticle(slug);
  if (!a) notFound();
  const t = await getTranslations('news');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.summary,
    datePublished: a.publishedAt,
    author: { '@type': 'Person', name: a.author.displayName },
    inLanguage: 'zh-CN',
  };
  return (
    <article className="bg-white rounded-lg border border-gray-200 p-6 max-w-3xl mx-auto">
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      <div className="text-xs text-muted flex gap-2">
        <span className="text-brand">{t(`category.${a.category as 'platform'}`)}</span>
        <span>{formatDate(a.publishedAt)}</span>
        <span>{a.author.displayName}</span>
      </div>
      <h1 className="text-2xl font-bold mt-2 mb-4">{a.title}</h1>
      {a.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.coverUrl}
          alt={a.title}
          className="w-full rounded-lg object-cover max-h-96 mb-4"
        />
      )}
      <p className="text-muted mb-4">{a.summary}</p>
      <ArticleBody body={a.body} />
      {a.source && (
        <p className="text-xs text-muted mt-6">
          {t('source')}: {a.source}
        </p>
      )}
      <p className="text-xs text-muted mt-2 border-t pt-3">{t('editorNote')}</p>
      <div className="mt-3 flex items-center gap-3">
        <FavoriteButton subjectType="article" subjectId={a.id} />
        <ReportButton subjectType="article" subjectId={a.id} />
      </div>
    </article>
  );
}
