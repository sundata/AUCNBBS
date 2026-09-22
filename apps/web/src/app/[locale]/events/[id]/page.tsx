import {  getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { api, apiBase, ApiError, type EventDetail } from '@/lib/api';
import { serverToken } from '@/lib/server-auth';
import { cityName, formatDateTime, formatMoney } from '@/lib/format';
import { CheckinForm, EventCancelButton, RsvpButton } from '@/components/event-panels';
import { FavoriteButton } from '@/components/favorite-button';
import { MapLink } from '@/components/map-embed';
import { ReportButton } from '@/components/report-button';
import { localeAlternates } from '@/lib/site';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const e = await api<EventDetail>(`/events/${id}`).catch(() => null);
  if (!e) return {};
  const desc = e.body?.slice(0, 140);
  return {
    title: e.title,
    description: desc,
    alternates: localeAlternates(`/events/${id}`),
    openGraph: { title: e.title, description: desc },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  let e: EventDetail;
  try {
    e = await api<EventDetail>(`/events/${id}`, { token: await serverToken() });
  } catch (err) {
    if (err instanceof ApiError && (err.problem.status === 404 || err.problem.status === 400))
      notFound();
    throw err;
  }
  const t = await getTranslations('events');

  return (
    <article className="max-w-3xl mx-auto bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <span className="px-1.5 py-0.5 rounded bg-gray-100">
          {t(`category.${e.category as 'other'}`)}
        </span>
        {e.online && (
          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{t('online')}</span>
        )}
        {e.status === 'cancelled' && (
          <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700">{t('cancelled')}</span>
        )}
        {e.recurrence && (
          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
            {t(`recurrence.${e.recurrence as 'weekly'}`)}
          </span>
        )}
      </div>
      <h1 className="text-2xl font-bold">{e.title}</h1>
      <dl className="text-sm space-y-1">
        <div className="flex gap-3">
          <dt className="w-28 text-muted">{t('when')}</dt>
          <dd>
            {formatDateTime(e.startsAt)} — {formatDateTime(e.endsAt)}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 text-muted">{t('where')}</dt>
          <dd>
            {e.online ? (
              t('online')
            ) : (
              <>
                {`${e.venue ?? ''} ${cityName(e.city)}`.trim()}{' '}
                {e.venue && <MapLink query={`${e.venue}, ${cityName(e.city)}, Australia`} />}
              </>
            )}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 text-muted">{t('organizer')}</dt>
          <dd>{e.organizer.displayName}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 text-muted">{t('price')}</dt>
          <dd>{e.priceMinor ? formatMoney(e.priceMinor) : t('free')}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 text-muted">{t('capacity')}</dt>
          <dd>
            {t('going', { count: e.goingCount })}
            {e.capacity ? ` / ${e.capacity}` : ` · ${t('unlimited')}`}
          </dd>
        </div>
      </dl>
      <p className="text-sm whitespace-pre-wrap leading-7 border-t pt-4">{e.body}</p>
      {e.externalUrl && (
        <p className="text-sm">
          <a href={e.externalUrl} className="text-brand underline" rel="noopener noreferrer">
            {t('ticketing')}
          </a>
        </p>
      )}
      {e.viewerRsvp === 'going' && e.checkinCode && (
        <div className="rounded border border-green-200 bg-green-50 p-3 text-sm">
          <p>{t('checkinCode')}</p>
          <p className="font-mono text-lg tracking-widest">{e.checkinCode}</p>
          {e.checkedInAt && <p className="text-green-700">{t('checkedIn')}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 border-t pt-4">
        {e.status === 'published' && !e.priceMinor && (
          <RsvpButton eventId={e.id} initial={e.viewerRsvp} />
        )}
        <a href={`${apiBase()}/api/v1/events/${e.id}/ics`} className="text-sm text-brand underline">
          {t('ics')}
        </a>
        <FavoriteButton subjectType="event" subjectId={e.id} />
        <ReportButton subjectType="event" subjectId={e.id} />
        {e.viewerIsOrganizer && e.status === 'published' && <EventCancelButton eventId={e.id} />}
      </div>
      {e.viewerIsOrganizer && e.status === 'published' && <CheckinForm eventId={e.id} />}
    </article>
  );
}
