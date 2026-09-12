'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { api, qs, type Page } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
interface Conversation {
  id: string;
  title: string;
  peer: { displayName: string };
  unread: number;
}
interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}
interface Notice {
  id: string;
  kind: string;
  subjectId: string;
  readAt: string | null;
}
export function MessagesPanel() {
  const t = useTranslations('messages');
  const { me, loading } = useAuth();
  const search = useSearchParams();
  const [selected, setSelected] = useState(search.get('conversation') ?? '');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [noticeNext, setNoticeNext] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : t('error')),
    [t],
  );
  const loadConversations = useCallback(async (cursor?: string) => {
    const token = await getAccessToken();
    const page = await api<Page<Conversation>>(`/messages/conversations${qs({ cursor })}`, {
      token,
    });
    setConversations((rows) => (cursor ? [...rows, ...page.items] : page.items));
    setNext(page.nextCursor);
  }, []);
  useEffect(() => {
    if (!me) return;
    void loadConversations().catch(fail);
    void (async () => {
      const token = await getAccessToken();
      const page = await api<Page<Notice>>('/messages/notifications', { token });
      setNotices(page.items);
      setNoticeNext(page.nextCursor);
    })().catch(fail);
  }, [me, loadConversations, fail]);
  useEffect(() => {
    if (!me || !selected) return;
    let cancelled = false;
    let initialLoad = true;
    setMessages([]);
    setOlder(null);
    const load = async () => {
      const token = await getAccessToken();
      const page = await api<Page<Message>>(`/messages/conversations/${selected}`, { token });
      if (cancelled) return;
      setMessages((rows) => [...new Map([...rows, ...page.items].map((m) => [m.id, m])).values()]);
      if (initialLoad) setOlder(page.nextCursor);
      initialLoad = false;
      await api(`/messages/conversations/${selected}/read`, { method: 'POST', token });
      if (!cancelled)
        setConversations((rows) => rows.map((c) => (c.id === selected ? { ...c, unread: 0 } : c)));
    };
    void load().catch(fail);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load().catch(fail);
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [me, selected, fail]);
  if (loading) return <p>{t('loading')}</p>;
  if (!me) return <Link href="/login?next=/messages">{t('login')}</Link>;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="grid md:grid-cols-3 gap-4">
        <aside className="bg-white border rounded p-4 space-y-3">
          {conversations.length === 0 && <p>{t('empty')}</p>}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`block w-full text-left p-2 rounded ${selected === c.id ? 'bg-red-50' : ''}`}
              onClick={() => setSelected(c.id)}
            >
              <strong>{c.peer.displayName}</strong>
              <p>{c.title}</p>
              {c.unread > 0 && <span>{t('unread', { count: c.unread })}</span>}
            </button>
          ))}
          {next && (
            <button onClick={() => void loadConversations(next).catch(fail)}>{t('more')}</button>
          )}
        </aside>
        <div className="md:col-span-2 bg-white border rounded p-4 space-y-3">
          {!selected ? (
            <p>{t('select')}</p>
          ) : (
            <>
              {older && (
                <button
                  onClick={() =>
                    void (async () => {
                      const token = await getAccessToken();
                      const page = await api<Page<Message>>(
                        `/messages/conversations/${selected}${qs({ cursor: older })}`,
                        { token },
                      );
                      setMessages((rows) => [
                        ...new Map([...rows, ...page.items].map((m) => [m.id, m])).values(),
                      ]);
                      setOlder(page.nextCursor);
                    })().catch(fail)
                  }
                >
                  {t('older')}
                </button>
              )}
              <div className="space-y-3 max-h-96 overflow-auto" aria-live="polite">
                {[...messages]
                  .sort(
                    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
                  )
                  .map((m) => (
                    <div
                      key={m.id}
                      className={`p-3 rounded whitespace-pre-wrap ${m.senderId === me.id ? 'bg-red-50 ml-8' : 'bg-gray-100 mr-8'}`}
                    >
                      <p>{m.body}</p>
                      <time className="text-xs text-muted">
                        {new Date(m.createdAt).toLocaleString()}
                      </time>
                    </div>
                  ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError('');
                  void (async () => {
                    const token = await getAccessToken();
                    const m = await api<Message>(`/messages/conversations/${selected}`, {
                      method: 'POST',
                      token,
                      body: JSON.stringify({ body }),
                    });
                    setMessages((rows) => [...rows, m]);
                    setBody('');
                  })()
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
                className="space-y-2"
              >
                <label className="block">
                  {t('message')}
                  <textarea
                    required
                    minLength={1}
                    maxLength={4000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="block border rounded w-full p-2"
                  />
                </label>
                <button
                  disabled={busy || !body.trim()}
                  className="bg-brand text-white rounded px-4 py-2 disabled:opacity-50"
                >
                  {t('send')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      <h2 className="font-bold">{t('notifications')}</h2>
      {notices.map((n) => (
        <p key={n.id}>
          {n.kind === 'message' ? (
            <button onClick={() => setSelected(n.subjectId)}>{t('newMessage')}</button>
          ) : n.kind === 'payment.paid' ? (
            t('paymentUpdate')
          ) : (
            t('reportUpdate')
          )}
          {!n.readAt && (
            <button
              className="ml-3 underline"
              onClick={() =>
                void (async () => {
                  await api(`/messages/notifications/${n.id}/read`, {
                    method: 'POST',
                    token: await getAccessToken(),
                  });
                  setNotices((rows) =>
                    rows.map((row) =>
                      row.id === n.id ? { ...row, readAt: new Date().toISOString() } : row,
                    ),
                  );
                })().catch(fail)
              }
            >
              {t('markRead')}
            </button>
          )}
        </p>
      ))}
      {noticeNext && (
        <button
          onClick={() =>
            void (async () => {
              const page = await api<Page<Notice>>(
                `/messages/notifications${qs({ cursor: noticeNext })}`,
                { token: await getAccessToken() },
              );
              setNotices((rows) => [...rows, ...page.items]);
              setNoticeNext(page.nextCursor);
            })().catch(fail)
          }
        >
          {t('more')}
        </button>
      )}
    </section>
  );
}
