import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export function SiteFooter() {
  const t = useTranslations('site');
  return (
    <footer className="border-t border-line bg-navy text-white/70 mt-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 text-xs space-y-2">
        <p>{t('disclaimer')}</p>
        <nav className="flex gap-4">
          <Link href="/privacy" className="hover:text-white underline">
            {t('privacy')}
          </Link>
          <Link href="/terms" className="hover:text-white underline">
            {t('terms')}
          </Link>
        </nav>
        <p>{t('footer', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
