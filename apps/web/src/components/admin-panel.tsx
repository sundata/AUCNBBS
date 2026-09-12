'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api, qs, type Page } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
interface Report {
  id: string;
  reference: string;
  subjectType: string;
  reason: string;
  details: string | null;
  severity: number;
  status: string;
  updatedAt: string;
}
interface Article {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  locale: string;
  source: string | null;
  status: string;
  updatedAt: string;
}
const blank = {
  slug: '',
  title: '',
  summary: '',
  body: '',
  category: 'life',
  locale: 'zh',
  source: '',
  status: 'draft',
};
export function AdminPanel() {
  const t = useTranslations('admin');
  const { me, loading } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [reportNext, setReportNext] = useState<string | null>(null);
  const [articleNext, setArticleNext] = useState<string | null>(null);
  const [filter, setFilter] = useState('open');
  const [reason, setReason] = useState('');
  const [subject, setSubject] = useState<Record<string, unknown> | null>(null);
  const [editing, setEditing] = useState<Article | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const review = !!me && ['moderator', 'admin', 'super_admin'].includes(me.role);
  const edit = !!me && ['editor', 'admin', 'super_admin'].includes(me.role);
  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : t('error')),
    [t],
  );
  const loadReports = useCallback(
    async (cursor?: string) => {
      const page = await api<Page<Report>>(`/admin/reports${qs({ status: filter, cursor })}`, {
        token: await getAccessToken(),
      });
      setReports((rows) => (cursor ? [...rows, ...page.items] : page.items));
      setReportNext(page.nextCursor);
    },
    [filter],
  );
  const loadArticles = useCallback(async (cursor?: string) => {
    const page = await api<Page<Article>>(`/admin/articles${qs({ cursor })}`, {
      token: await getAccessToken(),
    });
    setArticles((rows) => (cursor ? [...rows, ...page.items] : page.items));
    setArticleNext(page.nextCursor);
  }, []);
  useEffect(() => {
    if (review) void loadReports().catch(fail);
    if (edit) void loadArticles().catch(fail);
  }, [review, edit, loadReports, loadArticles, fail]);
  if (loading) return <p>{t('loading')}</p>;
  if (!me) return <Link href="/login?next=/admin">{t('login')}</Link>;
  if (!review && !edit) return <p>{t('forbidden')}</p>;
  return (
    <section className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {saved && <p role="status">{t('saved')}</p>}
      {review && (
        <section className="bg-white border rounded p-4 space-y-3">
          <h2 className="font-bold">{t('reports')}</h2>
          <label>
            {t('status')}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border rounded p-2 ml-2"
            >
              {['open', 'triaged', 'dismissed', 'actioned'].map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t('reason')}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              className="border p-2 w-full"
            />
          </label>
          {reports.length === 0 && <p>{t('empty')}</p>}
          {reports.map((r) => (
            <article key={r.id} className="border-t py-3 space-y-2">
              <h3>
                {r.reference} · {r.subjectType} · {r.reason} · {t('severity')} {r.severity}
              </h3>
              <p>{r.details}</p>
              <button
                className="underline"
                onClick={() =>
                  void (async () =>
                    api<Record<string, unknown>>(`/admin/reports/${r.id}/subject`, {
                      token: await getAccessToken(),
                    }))()
                    .then(setSubject)
                    .catch(fail)
                }
              >
                {t('inspect')}
              </button>
              <div className="flex gap-3">
                {['open', 'triaged'].includes(r.status) &&
                  ['triaged', 'dismissed', 'actioned'].map((status) => (
                    <button
                      key={status}
                      disabled={busy || reason.trim().length < 5}
                      className="border rounded px-3 py-1 disabled:opacity-40"
                      onClick={() => {
                        setBusy(true);
                        setError('');
                        void (async () => {
                          await api(`/admin/reports/${r.id}`, {
                            method: 'PATCH',
                            token: await getAccessToken(),
                            body: JSON.stringify({ status, reason, updatedAt: r.updatedAt }),
                          });
                          setReason('');
                          setSubject(null);
                          await loadReports();
                        })()
                          .catch(fail)
                          .finally(() => setBusy(false));
                      }}
                    >
                      {t(status)}
                    </button>
                  ))}
              </div>
            </article>
          ))}
          {subject && (
            <div className="bg-gray-50 border rounded p-3 whitespace-pre-wrap">
              {Object.entries(subject)
                .filter(([key]) => key !== 'id')
                .map(([key, value]) => (
                  <p key={key}>{String(value ?? '')}</p>
                ))}
              <button onClick={() => setSubject(null)}>{t('close')}</button>
            </div>
          )}
          {reportNext && (
            <button onClick={() => void loadReports(reportNext).catch(fail)}>{t('more')}</button>
          )}
          <p className="text-sm text-muted">{t('actionHint')}</p>
        </section>
      )}
      {edit && (
        <section className="bg-white border rounded p-4 space-y-3">
          <h2 className="font-bold">{t('cms')}</h2>
          <button
            onClick={() => {
              setEditing(null);
              setForm(blank);
              setSaved(false);
            }}
          >
            {t('new')}
          </button>
          {articles.map((a) => (
            <button
              key={a.id}
              className="block text-left underline"
              onClick={() => {
                setEditing(a);
                setForm({
                  slug: a.slug,
                  title: a.title,
                  summary: a.summary,
                  body: a.body,
                  category: a.category,
                  locale: a.locale,
                  source: a.source ?? '',
                  status: a.status === 'removed' ? 'hidden' : a.status,
                });
                setSaved(false);
              }}
            >
              {a.title} · {a.status}
            </button>
          ))}
          {articleNext && (
            <button onClick={() => void loadArticles(articleNext).catch(fail)}>{t('more')}</button>
          )}
          <form
            className="space-y-3 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              setSaved(false);
              void (async () => {
                await api(`/admin/articles${editing ? `/${editing.id}` : ''}`, {
                  method: editing ? 'PATCH' : 'POST',
                  token: await getAccessToken(),
                  body: JSON.stringify({
                    ...form,
                    source: form.source || null,
                    ...(editing ? { updatedAt: editing.updatedAt } : {}),
                  }),
                });
                setSaved(true);
                setEditing(null);
                setForm(blank);
                await loadArticles();
              })()
                .catch(fail)
                .finally(() => setBusy(false));
            }}
          >
            {(['slug', 'title', 'summary', 'body', 'category', 'source'] as const).map((key) => (
              <label key={key} className="block">
                {t(key === 'title' ? 'articleTitle' : key)}
                {key === 'body' || key === 'summary' ? (
                  <textarea
                    required
                    rows={key === 'body' ? 10 : 3}
                    className="border rounded w-full p-2"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                ) : (
                  <input
                    required={key !== 'source'}
                    type={key === 'source' ? 'url' : 'text'}
                    className="border rounded w-full p-2"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            <label>
              {t('locale')}
              <select
                value={form.locale}
                onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              {t('status')}
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {['draft', 'published', 'hidden'].map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || editing?.status === 'removed'}
              className="block bg-brand text-white rounded px-4 py-2 disabled:opacity-40"
            >
              {t('save')}
            </button>
          </form>
        </section>
      )}
    </section>
  );
}
