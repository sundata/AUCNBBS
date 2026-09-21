'use client';
/* eslint-disable @next/next/no-img-element -- public API media endpoint */
export function DailyCover({ id, alt }: { id: string; alt: string }) {
  return (
    <img
      src={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/daily-notes/${id}/cover`}
      alt={alt}
      loading="lazy"
      className="w-full aspect-[3/4] object-contain bg-slate-50"
    />
  );
}
