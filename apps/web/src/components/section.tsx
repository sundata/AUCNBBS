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
    <section className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold border-l-4 border-brand pl-2">{title}</h2>
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
