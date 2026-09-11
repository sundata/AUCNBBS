'use client';

import { useTranslations } from 'next-intl';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="py-16 text-center space-y-3">
      <p className="text-lg">{t('error')}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-brand text-white px-4 py-1.5 text-sm"
      >
        {t('retry')}
      </button>
    </div>
  );
}
