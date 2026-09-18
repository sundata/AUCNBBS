'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { api, apiBase, qs, type CityDto, type PulseFeedItem } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { Link } from '@/i18n/routing';

export interface WeekendEvent {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
  suburb: string;
  venue: string;
  startsAt: string | null;
  endsAt: string | null;
  priceMinor: number | null;
  family: boolean | null;
  indoor: boolean | null;
  booking: string;
  status: string;
  reviewedAt: string | null;
  updatedAt: string;
}
interface Result {
  items: WeekendEvent[];
  total: number;
  suburbs: string[];
  weekend: { from: string; to: string };
}
const CATS = ['general', 'family', 'social', 'market', 'festival'] as const;
export function WeekendGuide() {
  const zh = useLocale() === 'zh';
  const { me } = useAuth();
  const [period, setPeriod] = useState('weekend');
  const [free, setFree] = useState(false);
  const [family, setFamily] = useState(false);
  const [indoor, setIndoor] = useState(false);
  const [suburb, setSuburb] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [cities, setCities] = useState<CityDto[]>([]);
  const [page, setPage] = useState(1);
  const [savedOnly, setSavedOnly] = useState(false);
  const [saved, setSaved] = useState<WeekendEvent[]>([]);
  const [data, setData] = useState<Result | null>(null);
  const [intel, setIntel] = useState<PulseFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const date = (v: string) =>
    new Date(v).toLocaleString(zh ? 'zh-CN' : 'en-AU', {
      timeZone: 'Australia/Sydney',
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const loadSaved = useCallback(async () => {
    if (!me) {
      setSaved([]);
      return;
    }
    const rows = await api<{ event: WeekendEvent }[]>('/weekend/saved', {
      token: await getAccessToken(),
    });
    setSaved(rows.map((r) => r.event));
  }, [me]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<Result>(
      `/weekend/events${qs({ period, free: String(free), family: String(family), indoor: String(indoor), suburb, city, category, page })}`,
    )
      .then((r) => {
        if (active) setData(r);
      })
      .catch(() => {
        if (active)
          setError(zh ? '活动暂时无法加载，请重试。' : 'Could not load events. Please retry.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, free, family, indoor, suburb, city, category, page, zh]);
  useEffect(() => {
    void api<CityDto[]>('/cities')
      .then(setCities)
      .catch(() => setCities([]));
  }, []);
  useEffect(() => {
    void api<{ items: PulseFeedItem[] }>(`/pulse/feed${qs({ category: 'event', city })}`)
      .then((r) => setIntel(r.items.slice(0, 9)))
      .catch(() => setIntel([]));
  }, [city]);
  useEffect(() => {
    void loadSaved().catch(() => setError(zh ? '收藏加载失败' : 'Could not load saved events'));
  }, [loadSaved, zh]);
  const reset = () => setPage(1);
  const rows = savedOnly ? saved : (data?.items ?? []);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-sm font-medium text-brand">
            SYDNEY · {zh ? '周末生活' : 'WEEKEND GUIDE'}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold text-navy mt-2">
            {zh ? '这周末，去哪儿？' : 'Where to this weekend?'}
          </h1>
          <p className="mt-3 text-muted">
            {zh
              ? '找个附近的活动，把周末留给生活。所有时间均为悉尼当地时间。'
              : 'Find something nearby. All times are local to Sydney.'}
          </p>
        </div>
        <button
          className="border border-line rounded-xl px-4 py-3 bg-white"
          aria-pressed={savedOnly}
          onClick={() => setSavedOnly(!savedOnly)}
        >
          {savedOnly ? (zh ? '返回活动' : 'Browse events') : zh ? '我的收藏' : 'Saved events'}
        </button>
      </div>
      {!savedOnly && (
        <div className="rounded-2xl border border-line bg-white p-4 flex flex-wrap gap-4 items-center">
          <label className="space-x-2">
            {zh ? '日期' : 'When'}
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                reset();
              }}
              className="border rounded-lg p-2"
            >
              <option value="weekend">{zh ? '本周末' : 'This weekend'}</option>
              <option value="upcoming">{zh ? '所有即将举行' : 'All upcoming'}</option>
            </select>
          </label>
          <label className="space-x-2">
            {zh ? '城市' : 'City'}
            <select
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setSuburb('');
                reset();
              }}
              className="border rounded-lg p-2"
            >
              <option value="">{zh ? '全部城市' : 'All cities'}</option>
              {cities.map((c) => (
                <option key={c.id} value={c.slug}>
                  {zh ? c.nameZh : c.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="space-x-2">
            {zh ? '类型' : 'Type'}
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                reset();
              }}
              className="border rounded-lg p-2"
            >
              <option value="">{zh ? '全部类型' : 'All types'}</option>
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {zh
                    ? (
                        {
                          general: '综合',
                          family: '亲子',
                          social: '社交',
                          market: '集市',
                          festival: '节庆',
                        } as const
                      )[c]
                    : c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-x-2">
            {zh ? '区域' : 'Suburb'}
            <select
              value={suburb}
              onChange={(e) => {
                setSuburb(e.target.value);
                reset();
              }}
              className="border rounded-lg p-2"
            >
              <option value="">{zh ? '悉尼所有区域' : 'All Sydney suburbs'}</option>
              {data?.suburbs.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {[
            [free, setFree, zh ? '免费' : 'Free'],
            [family, setFamily, zh ? '适合亲子' : 'Family friendly'],
            [indoor, setIndoor, zh ? '室内活动' : 'Indoors'],
          ].map(([checked, setter, label], i) => (
            <label className="flex gap-2 items-center px-2 py-2" key={i}>
              <input
                type="checkbox"
                checked={checked as boolean}
                onChange={(e) => {
                  (setter as (v: boolean) => void)(e.target.checked);
                  reset();
                }}
              />
              {label as string}
            </label>
          ))}
        </div>
      )}
      {savedOnly && !me && (
        <Link className="text-brand underline" href="/login?next=/weekend">
          {zh ? '登录后可收藏活动' : 'Sign in to save events'}
        </Link>
      )}
      {!savedOnly && intel.length > 0 && (
        <section className="rounded-2xl border border-line bg-white p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-navy">
              {zh ? '最新活动情报' : 'Latest event intel'}
            </h2>
            <Link href="/pulse?category=event" className="text-sm text-brand">
              {zh ? '查看全部 →' : 'View all →'}
            </Link>
          </div>
          <p className="text-sm text-muted">
            {zh
              ? '自动采集自本地活动媒体，点击跳主办方原文。'
              : 'Auto-collected from local event media — links open the organiser’s page.'}
          </p>
          <ul className="divide-y divide-line">
            {intel.map((item) => (
              <li key={item.id} className="py-3">
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-navy hover:text-brand"
                >
                  {item.title}
                </a>
                <p className="text-sm text-muted mt-1">
                  {item.sourceName}
                  {' · '}
                  {date(item.publishedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!savedOnly && loading ? (
        <p role="status">{zh ? '正在查找活动…' : 'Loading events…'}</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {savedOnly
              ? zh
                ? '收藏会保留，已结束或取消的活动会标明状态。'
                : 'Saved events include ended or cancelled listings.'
              : zh
                ? `找到 ${data?.total ?? 0} 个活动`
                : `${data?.total ?? 0} events found`}
          </p>
          {rows.length === 0 &&
            (intel.length > 0 && !savedOnly ? (
              <p className="text-sm text-muted">
                {zh
                  ? '精选活动核验中，先看看上方的活动情报。'
                  : 'Curated events are under review — check the intel list above.'}
              </p>
            ) : (
              <div className="border border-dashed border-line rounded-2xl p-10 text-center">
                <h2 className="text-lg font-medium">
                  {zh ? '还没有符合条件的活动' : 'No matching events yet'}
                </h2>
                <p className="mt-2 text-muted">
                  {zh
                    ? '试试其他日期或区域。我们会在核验后加入新活动。'
                    : 'Try another date or suburb. New events appear after review.'}
                </p>
              </div>
            ))}
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((event) => {
              const isSaved = saved.some((e) => e.id === event.id);
              const ended = !!event.endsAt && new Date(event.endsAt) <= new Date();
              const unavailable = event.status !== 'published' || ended;
              return (
                <article
                  key={event.id}
                  className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-sm"
                >
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="font-medium text-brand">{event.suburb || 'Sydney'}</span>
                    <span>
                      {event.priceMinor === 0
                        ? zh
                          ? '免费'
                          : 'Free'
                        : event.priceMinor === null
                          ? zh
                            ? '费用待确认'
                            : 'Price unconfirmed'
                          : `A$${(event.priceMinor / 100).toFixed(2)}`}
                    </span>
                  </div>
                  <h2 className="text-xl text-navy font-semibold mt-3">{event.title}</h2>
                  <p className="mt-3 text-muted leading-relaxed flex-1">{event.summary}</p>
                  <p className="mt-4 font-medium">
                    {event.startsAt ? date(event.startsAt) : zh ? '日期待确认' : 'Date unconfirmed'}
                  </p>
                  {event.endsAt && (
                    <p className="text-sm text-muted">
                      {zh ? '至 ' : 'Until '}
                      {date(event.endsAt)}
                    </p>
                  )}
                  <p className="mt-2">{event.venue}</p>
                  <div className="flex flex-wrap gap-2 mt-3 text-sm">
                    {event.category && event.category !== 'general' && (
                      <span className="bg-purple-50 text-purple-900 rounded px-2 py-1">
                        {zh
                          ? (
                              {
                                family: '亲子',
                                social: '社交',
                                market: '集市',
                                festival: '节庆',
                              } as Record<string, string>
                            )[event.category]
                          : event.category}
                      </span>
                    )}
                    {event.family && (
                      <span className="bg-blue-50 text-blue-900 rounded px-2 py-1">
                        {zh ? '亲子' : 'Family'}
                      </span>
                    )}
                    {event.indoor && (
                      <span className="bg-blue-50 text-blue-900 rounded px-2 py-1">
                        {zh ? '室内' : 'Indoors'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm mt-3">
                    {unavailable
                      ? ended
                        ? zh
                          ? '活动已结束'
                          : 'Event ended'
                        : zh
                          ? '活动已取消或下架'
                          : 'Cancelled or withdrawn'
                      : event.booking === 'sold_out'
                        ? zh
                          ? '已满额'
                          : 'Sold out'
                        : event.booking === 'required'
                          ? zh
                            ? '需要预约，余位请查主办方'
                            : 'Booking required; check availability'
                          : event.booking === 'not_required'
                            ? zh
                              ? '无需预约，出发前请确认'
                              : 'No booking required; check before travelling'
                            : zh
                              ? '预约及余位请查主办方'
                              : 'Check booking and availability with organiser'}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-4">
                    <a
                      className="rounded-lg bg-brand text-white px-3 py-2"
                      href={event.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {zh ? '主办方详情' : 'View original'}
                    </a>
                    {me ? (
                      <button
                        disabled={busy === event.id || (!isSaved && unavailable)}
                        aria-pressed={isSaved}
                        className="border rounded-lg px-3 py-2 disabled:opacity-50"
                        onClick={async () => {
                          setBusy(event.id);
                          setError('');
                          try {
                            await api(`/weekend/events/${event.id}/save`, {
                              method: isSaved ? 'DELETE' : 'POST',
                              token: await getAccessToken(),
                            });
                            await loadSaved();
                          } catch {
                            setError(zh ? '收藏操作失败，请重试' : 'Could not update saved event');
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {isSaved ? (zh ? '取消收藏' : 'Unsave') : zh ? '收藏' : 'Save'}
                      </button>
                    ) : (
                      <Link className="border rounded-lg px-3 py-2" href="/login?next=/weekend">
                        {zh ? '登录收藏' : 'Sign in to save'}
                      </Link>
                    )}
                    {!unavailable && (
                      <a
                        className="text-brand underline py-2"
                        href={`${apiBase()}/api/v1/weekend/events/${event.id}/calendar`}
                      >
                        {zh ? '加入日历提醒' : 'Add calendar reminder'}
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-muted mt-4">
                    {zh ? '来源：' : 'Source: '}
                    {event.sourceName}
                    {event.reviewedAt && (
                      <>
                        {' '}
                        · {zh ? '核验于 ' : 'Reviewed '}
                        {date(event.reviewedAt)}
                      </>
                    )}
                  </p>
                </article>
              );
            })}
          </div>
          {!savedOnly && (
            <div className="flex gap-4 justify-center items-center">
              <button
                className="border rounded px-3 py-2 disabled:opacity-40"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                {zh ? '上一页' : 'Previous'}
              </button>
              <span>{page}</span>
              <button
                className="border rounded px-3 py-2 disabled:opacity-40"
                disabled={page * 20 >= (data?.total ?? 0)}
                onClick={() => setPage(page + 1)}
              >
                {zh ? '下一页' : 'Next'}
              </button>
            </div>
          )}
        </>
      )}
      <p className="text-sm text-muted">
        {zh
          ? '日历文件包含提前一天提醒；请在日历应用中确认已导入并开启通知。活动变动不会自动同步至已下载的日历。'
          : 'Calendar files include a one-day reminder. Import them and enable notifications in your calendar app. Later event changes are not synced to downloaded calendars.'}
      </p>
    </section>
  );
}
