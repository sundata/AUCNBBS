'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { api, apiBase } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { DailyNoteView, type DailyNote } from './daily-note-view';
import { Link } from '@/i18n/routing';
function Preview({ note }: { note: DailyNote }) {
  const [cover, setCover] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setCover(undefined);
    setError(false);
    void (async () => {
      const token = await getAccessToken();
      const res = await fetch(`${apiBase()}/api/v1/daily-notes/admin/${note.id}/cover`, {
        credentials: 'include',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error();
      url = URL.createObjectURL(await res.blob());
      if (active) setCover(url);
      else URL.revokeObjectURL(url);
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [note.id]);
  return error ? (
    <p role="alert">封面加载失败 / Cover unavailable</p>
  ) : cover ? (
    <DailyNoteView note={note} cover={cover} />
  ) : (
    <p>加载预览… / Loading preview…</p>
  );
}
export function DailyNotesAdmin() {
  const zh = useLocale() === 'zh';
  const { me, loading } = useAuth();
  const allowed = !!me && ['editor', 'admin', 'super_admin'].includes(me.role);
  const [status, setStatus] = useState('draft');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DailyNote[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<DailyNote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await api<{ items: DailyNote[]; total: number }>(
      `/daily-notes/admin/items?status=${status}&page=${page}`,
      { token: await getAccessToken() },
    );
    setRows(result.items);
    setTotal(result.total);
  }, [status, page]);
  useEffect(() => {
    if (allowed) void load().catch((e) => setError(e.message));
  }, [allowed, load]);
  if (loading) return <p>Loading…</p>;
  if (!me) return <Link href="/login?next=/admin/daily">{zh ? '请登录' : 'Sign in'}</Link>;
  if (!allowed) return <p>{zh ? '需要编辑权限' : 'Editor access required'}</p>;
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold">{zh ? '每日图文接收箱' : 'Daily story inbox'}</h1>
      <p className="text-muted">
        {zh
          ? '核对正文、封面和来源后发布。自动任务重试不会重复建稿。'
          : 'Review the text, cover and sources before publishing. Delivery retries are deduplicated.'}
      </p>
      <label>
        {zh ? '状态' : 'Status'}{' '}
        <select
          className="border p-2 rounded"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
            setSelected(null);
          }}
        >
          <option value="draft">{zh ? '待审核' : 'Draft'}</option>
          <option value="published">{zh ? '已发布' : 'Published'}</option>
          <option value="hidden">{zh ? '已下架' : 'Hidden'}</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <ul className="divide-y bg-white border rounded-xl">
        {rows.map((n) => (
          <li key={n.id} className="p-4 flex flex-wrap gap-4 items-center">
            <button
              className="text-left flex-1 text-brand underline"
              onClick={() => setSelected(n)}
            >
              {n.edition} · {n.title}
            </button>
            <span className="text-sm text-muted">{n.city}</span>
          </li>
        ))}
      </ul>
      {!rows.length && <p>{zh ? '暂无稿件' : 'No stories yet'}</p>}
      <div className="flex gap-4">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          {zh ? '上一页' : 'Previous'}
        </button>
        <span>{page}</span>
        <button disabled={page * 12 >= total} onClick={() => setPage(page + 1)}>
          {zh ? '下一页' : 'Next'}
        </button>
      </div>
      {selected && (
        <>
          <Preview note={selected} />
          <div className="flex gap-4">
            {(['published', 'hidden', 'draft'] as const)
              .filter((s) => s !== selected.status)
              .map((s) => (
                <button
                  disabled={busy}
                  className="bg-brand text-white px-4 py-2 rounded-lg disabled:opacity-50"
                  key={s}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const row = await api<DailyNote>(`/daily-notes/admin/${selected.id}`, {
                        method: 'PATCH',
                        token: await getAccessToken(),
                        body: JSON.stringify({ status: s, updatedAt: selected.updatedAt }),
                      });
                      setSelected(row);
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {s === 'published'
                    ? zh
                      ? '发布到网站'
                      : 'Publish'
                    : s === 'hidden'
                      ? zh
                        ? '下架'
                        : 'Hide'
                      : zh
                        ? '撤回草稿'
                        : 'Move to draft'}
                </button>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
