import { useTranslations } from 'next-intl';

export function SiteFooter() {
  const t = useTranslations('site');
  return (
    <footer className="border-t border-gray-200 bg-white mt-8">
      <div className="max-w-6xl mx-auto px-4 py-6 text-xs text-muted space-y-2">
        <p>{t('disclaimer')}</p>
        <p>{t('footer', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
