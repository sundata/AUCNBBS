import type { ReactNode } from 'react';
import { Link } from '@/i18n/routing';

export function Section({
  title,
  href,
  more,
  children,
}: {
  title: string;
  href?: string;
  more?: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-paper rounded-2xl border border-line/80 p-4 sm:p-5 shadow-[0_8px_24px_rgba(18,48,74,0.05)]">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-navy border-l-4 border-brand pl-2">{title}</h2>
        {href && more && (
          <Link href={href} className="text-xs text-muted hover:text-brand">
            {more} ›
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted py-6 text-center">{text}</p>;
}
