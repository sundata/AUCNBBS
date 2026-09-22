import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { api, qs, type BoardDto, type Page, type PostSummary } from '@/lib/api';
import { cityName, formatDate } from '@/lib/format';
import { first, resolveCity, type SearchParams } from '@/lib/server';
import { Empty } from '@/components/section';
import { sectionMeta } from '@/lib/meta';

export const generateMetadata = sectionMeta('meta.community', '/community');

export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const board = first(sp.board);
  const city = await resolveCity(first(sp.city));
  const [boards, page] = await Promise.all([
    api<BoardDto[]>('/community/boards'),
    api<Page<PostSummary>>(
      `/community/posts${qs({ board, cityId: city?.id, cursor: first(sp.cursor) })}`,
    ),
  ]);
  const t = await getTranslations('community');
  const tl = await getTranslations('listing');
  const boardName = (b: BoardDto) => (b.nameZh);

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <aside className="bg-white rounded-lg border border-gray-200 p-3">
        <h2 className="font-semibold mb-2 text-sm">{t('boards')}</h2>
        <ul className="text-sm space-y-1">
          <li>
            <Link
              href={`/community${qs({ city: city?.slug })}`}
              className={`block px-2 py-1 rounded ${!board ? 'bg-red-50 text-brand' : 'hover:bg-gray-50'}`}
            >
              {t('latest')}
            </Link>
          </li>
          {boards.map((b) => (
            <li key={b.id}>
              <Link
                href={`/community${qs({ board: b.slug, city: city?.slug })}`}
                className={`flex justify-between px-2 py-1 rounded ${board === b.slug ? 'bg-red-50 text-brand' : 'hover:bg-gray-50'}`}
              >
                <span>{boardName(b)}</span>
                <span className="text-xs text-muted">{t('posts', { count: b.postCount })}</span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <div className="lg:col-span-3 bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">
            {board ? boardName(boards.find((b) => b.slug === board) ?? boards[0]) : t('latest')}
          </h1>
          <Link
            href={`/post${qs({ type: 'post', board })}`}
            className="text-sm rounded bg-brand text-white px-3 py-1.5"
          >
            + {t('newPost')}
          </Link>
        </div>
        {board && (
          <p className="text-xs text-muted mb-3">
            {(() => {
              const b = boards.find((x) => x.slug === board);
              return b ? (b.descriptionZh) : '';
            })()}
          </p>
        )}
        {page.items.length === 0 ? (
          <Empty text={tl('empty')} />
        ) : (
          <ul className="divide-y divide-gray-100">
            {page.items.map((p) => (
              <li key={p.id} className="py-2.5 flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/community/posts/${p.id}`}
                    className="font-medium hover:text-brand line-clamp-1"
                  >
                    {p.pinned && <span className="text-brand text-xs mr-1">📌</span>}
                    {p.type === 'question' && (
                      <span className="text-xs text-blue-700 bg-blue-50 px-1 rounded mr-1">
                        {t('question')}
                      </span>
                    )}
                    {p.title}
                  </Link>
                  <div className="text-xs text-muted mt-0.5">
                    {[
                      boardName(boards.find((b) => b.slug === p.boardSlug) ?? boards[0]),
                      p.author.anonymous ? t('anonymousName') : p.author.displayName,
                      cityName(p.city),
                      formatDate(p.lastActiveAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <span className="text-xs text-muted shrink-0">
                  {t('comments', { count: p.commentCount })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor && (
          <Link
            href={`/community${qs({ board, city: city?.slug, cursor: page.nextCursor })}`}
            className="block text-center text-sm text-brand mt-4"
          >
            {tl('loadMore')}
          </Link>
        )}
      </div>
    </div>
  );
}
