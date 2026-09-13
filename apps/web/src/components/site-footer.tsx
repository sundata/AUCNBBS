import { useTranslations } from 'next-intl';

export function SiteFooter() {
  const t = useTranslations('site');
  return (
    <footer className="border-t border-line bg-navy text-white/70 mt-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 text-xs space-y-2">
        <p>{t('disclaimer')}</p>
        <p>{t('footer', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
