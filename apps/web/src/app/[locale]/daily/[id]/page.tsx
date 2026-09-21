import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { DailyNoteView, type DailyNote } from '@/components/daily-note-view';
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    return <DailyNoteView note={await api<DailyNote>(`/daily-notes/${id}`)} />;
  } catch (e) {
    if (e instanceof ApiError && e.problem.status === 404) notFound();
    throw e;
  }
}
