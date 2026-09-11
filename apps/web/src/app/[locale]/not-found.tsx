import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export default function NotFound() {
  const t = useTranslations('listing');
  const tc = useTranslations('common');
  return (
    <div className="py-16 text-center space-y-3">
      <p className="text-lg">{t('notFound')}</p>
      <Link href="/" className="text-brand underline text-sm">
        {tc('back')}
      </Link>
    </div>
  );
}
