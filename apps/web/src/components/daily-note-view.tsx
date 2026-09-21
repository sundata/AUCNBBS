'use client';
/* eslint-disable @next/next/no-img-element -- authenticated/local API image endpoint */
import { useLocale } from 'next-intl';
export interface DailyNote {
  id: string;
  city: string;
  edition: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  sources: { title: string; url: string }[];
  imageKind: string;
  imageCredit: string;
  imageAlt: string;
  status: string;
  updatedAt: string;
}
export function DailyNoteView({ note, cover }: { note: DailyNote; cover?: string }) {
  const zh = useLocale() === 'zh';
  return (
    <article className="max-w-3xl mx-auto rounded-2xl border border-line bg-white p-5 sm:p-8">
      <p className="text-sm text-brand">
        {note.city === 'melbourne'
          ? '墨尔本 · Melbourne'
          : note.city === 'tokyo'
            ? '东京 · Tokyo'
            : '东京 × 墨尔本'}{' '}
        · {note.edition}
      </p>
      <h1 className="text-2xl sm:text-3xl font-semibold mt-3">{note.title}</h1>
      <p className="my-5 text-muted leading-7">{note.summary}</p>
      <figure className="mb-6">
        <img
          src={cover ?? `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/daily-notes/${note.id}/cover`}
          alt={note.imageAlt}
          className="w-full max-h-[720px] object-contain rounded-xl bg-slate-50"
        />
        <figcaption className="mt-2 text-sm text-muted">
          {note.imageKind === 'generated'
            ? zh
              ? 'AI 生成示意图 · '
              : 'AI-generated illustration · '
            : ''}
          {note.imageCredit}
        </figcaption>
      </figure>
      <div className="whitespace-pre-wrap leading-8 break-words">{note.body}</div>
      <div className="flex flex-wrap gap-2 mt-6">
        {note.tags.map((tag, i) => (
          <span className="text-sm text-brand bg-blue-50 px-2 py-1 rounded" key={i}>
            #{tag.replace(/^#/, '')}
          </span>
        ))}
      </div>
      <section className="mt-6 border-t pt-4">
        <h2 className="font-semibold">{zh ? '信息来源' : 'Sources'}</h2>
        <ul className="mt-2 space-y-2">
          {note.sources.map((s, i) => (
            <li key={i}>
              <a
                className="text-brand underline break-words"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
