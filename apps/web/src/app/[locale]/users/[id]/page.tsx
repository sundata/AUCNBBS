import type { Metadata } from 'next';
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link, type AppLocale } from '@/i18n/routing';
import { api, ApiError, apiBase } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { FollowButton } from '@/components/follow-button';
import { ReportButton } from '@/components/report-button';

interface PublicProfile {
  id: string;
  displayName: string;
  bio: string | null;
  avatarMediaId: string | null;
  memberSince: string;
  postCount: number;
  listings: {
    id: string;
    type: string;
    title: string;
    priceMinor: number | null;
    currency: string;
    publishedAt: string | null;
  }[];
}

async function load(id: string): Promise<PublicProfile | null> {
  try {
    return await api<PublicProfile>(`/users/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.problem.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const u = await load(id);
  if (!u) return {};
  return {
    title: u.displayName,
    description: u.bio ?? undefined,
    alternates: { canonical: `/users/${u.id}` },
  };
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const u = await load(id);
  if (!u) notFound();
  const t = await getTranslations('profile');
  const loc = (await getLocale()) as AppLocale;
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="bg-white rounded-lg border border-gray-200 p-6 flex gap-4 items-start">
        {u.avatarMediaId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${apiBase()}/api/v1/media/${u.avatarMediaId}`}
            alt=""
            className="w-16 h-16 rounded-full object-cover"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-xl">
            {u.displayName.slice(0, 1)}
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{u.displayName}</h1>
          <p className="text-sm text-muted">
            {t('memberSince', { date: formatDate(u.memberSince, loc) })} ·{' '}
            {t('postCount', { count: u.postCount })}
          </p>
          {u.bio && <p className="mt-2 whitespace-pre-wrap">{u.bio}</p>}
          <div className="mt-3 flex gap-3">
            <FollowButton subjectId={u.id} />
            <ReportButton subjectType="user" subjectId={u.id} />
          </div>
        </div>
      </header>
      {u.listings.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold mb-3">{t('listings')}</h2>
          <ul className="divide-y">
            {u.listings.map((l) => (
              <li key={l.id} className="py-2">
                <Link href={`/listings/${l.type}/${l.id}`} className="text-brand hover:underline">
                  {l.title}
                </Link>
                {l.priceMinor !== null && (
                  <span className="text-sm text-muted ml-2">
                    {(l.priceMinor / 100).toFixed(0)} {l.currency}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
