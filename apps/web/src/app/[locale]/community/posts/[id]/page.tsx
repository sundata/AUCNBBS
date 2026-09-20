import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { api, ApiError, type PostDetail } from '@/lib/api';
import { serverToken } from '@/lib/server-auth';
import { cityName, formatDate } from '@/lib/format';
import { CommentForm } from '@/components/comment-form';
import { ReportButton } from '@/components/report-button';
import { FavoriteButton } from '@/components/favorite-button';
import { PollBox } from '@/components/poll-box';
import { AcceptAnswer, PostTools } from '@/components/post-tools';

export default async function PostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  let p: PostDetail;
  try {
    p = await api<PostDetail>(`/community/posts/${id}`, { token: await serverToken() });
  } catch (e) {
    if (e instanceof ApiError && (e.problem.status === 404 || e.problem.status === 400)) notFound();
    throw e;
  }
  const t = await getTranslations('community');
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
          <span>
            {p.author.anonymous || !p.author.id ? (
              t('anonymousName')
            ) : (
              <Link href={`/users/${p.author.id}`} className="hover:text-brand">
                {p.author.displayName}
              </Link>
            )}
          </span>
          {p.edited && <span>{t('edited')}</span>}
          {p.locked && <span>{t('locked')}</span>}
          {p.city && <span>{cityName(p.city)}</span>}
          <span>{formatDate(p.createdAt)}</span>
        </div>
        <h1 className="text-2xl font-bold mt-2 mb-4">{p.title}</h1>
        <div className="whitespace-pre-wrap leading-7">{p.body}</div>
        {p.poll && <PollBox postId={p.id} poll={p.poll} />}
        <div className="mt-4 flex items-center gap-3">
          <FavoriteButton subjectType="post" subjectId={p.id} />
          <ReportButton subjectType="post" subjectId={p.id} />
        </div>
        <PostTools post={p} isOwner={p.viewerIsAuthor} />
      </article>
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-3">{t('comments', { count: p.commentCount })}</h2>
        {roots.length === 0 && <p className="text-sm text-muted">{t('noComments')}</p>}
        <ul className="space-y-4">
          {roots.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="text-xs text-muted">
                {c.author.anonymous ? t('anonymousName') : c.author.displayName} ·{' '}
                {formatDate(c.createdAt)}
                {c.edited && ` · ${t('edited')}`}
                {c.accepted && ` · ${t('accepted')}`}
              </div>
              <p className="whitespace-pre-wrap mt-1">{c.body}</p>
              <div className="flex gap-3 items-center mt-1">
                <ReportButton subjectType="comment" subjectId={c.id} />
                {!p.locked && <CommentForm postId={p.id} parentId={c.id} inline />}
                {p.type === 'question' && (
                  <AcceptAnswer
                    postId={p.id}
                    commentId={c.id}
                    accepted={c.accepted}
                    canAccept={p.viewerIsAuthor}
                  />
                )}
              </div>
              {children(c.id).length > 0 && (
                <ul className="mt-2 ml-4 pl-3 border-l border-gray-200 space-y-2">
                  {children(c.id).map((r) => (
                    <li key={r.id}>
                      <div className="text-xs text-muted">
                        {r.author.anonymous ? t('anonymousName') : r.author.displayName} ·{' '}
                        {formatDate(r.createdAt)}
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
          {p.locked ? (
            <p className="text-sm text-muted">{t('lockedHint')}</p>
          ) : (
            <CommentForm postId={p.id} />
          )}
        </div>
      </section>
    </div>
  );
}
