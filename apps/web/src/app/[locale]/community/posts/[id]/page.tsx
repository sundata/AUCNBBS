import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, ApiError, type PostDetail } from '@/lib/api';
import { cityName, formatDate } from '@/lib/format';
import { CommentForm } from '@/components/comment-form';
import { ReportButton } from '@/components/report-button';

export default async function PostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  let p: PostDetail;
  try {
    p = await api<PostDetail>(`/community/posts/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.problem.status === 404 || e.problem.status === 400)) notFound();
    throw e;
  }
  const t = await getTranslations('community');
  const loc = (await getLocale()) as AppLocale;
  const roots = p.comments.filter((c) => !c.parentId);
  const children = (parentId: string) => p.comments.filter((c) => c.parentId === parentId);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <article className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="text-xs text-muted flex gap-2">
          <Link href={`/community?board=${p.boardSlug}`} className="text-brand">
            {p.boardSlug}
          </Link>
          {p.type === 'question' && <span>{t('question')}</span>}
          <span>{p.author.displayName}</span>
          {p.city && <span>{cityName(p.city, loc)}</span>}
          <span>{formatDate(p.createdAt, loc)}</span>
        </div>
        <h1 className="text-2xl font-bold mt-2 mb-4">{p.title}</h1>
        <div className="whitespace-pre-wrap leading-7">{p.body}</div>
        <div className="mt-4">
          <ReportButton subjectType="post" subjectId={p.id} />
        </div>
      </article>
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-3">{t('comments', { count: p.commentCount })}</h2>
        {roots.length === 0 && <p className="text-sm text-muted">{t('noComments')}</p>}
        <ul className="space-y-4">
          {roots.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="text-xs text-muted">
                {c.author.displayName} · {formatDate(c.createdAt, loc)}
              </div>
              <p className="whitespace-pre-wrap mt-1">{c.body}</p>
              <div className="flex gap-3 items-center mt-1">
                <ReportButton subjectType="comment" subjectId={c.id} />
                <CommentForm postId={p.id} parentId={c.id} inline />
              </div>
              {children(c.id).length > 0 && (
                <ul className="mt-2 ml-4 pl-3 border-l border-gray-200 space-y-2">
                  {children(c.id).map((r) => (
                    <li key={r.id}>
                      <div className="text-xs text-muted">
                        {r.author.displayName} · {formatDate(r.createdAt, loc)}
                      </div>
                      <p className="whitespace-pre-wrap mt-0.5">{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-6 border-t pt-4">
          <CommentForm postId={p.id} />
        </div>
      </section>
    </div>
  );
}
