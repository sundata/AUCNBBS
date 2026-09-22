import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { localeAlternates } from '@/lib/site';

/**
 * generateMetadata factory for section index pages. Reads `title` and `desc`
 * from the given messages namespace and emits canonical/hreflang alternates.
 */
export function sectionMeta(namespace: string, path: string) {
  return async function generateMetadata({
    params,
  }: {
    params: Promise<{ locale: string }>;
  }): Promise<Metadata> {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace });
    return {
      title: t('title'),
      description: t('desc'),
      alternates: localeAlternates(path),
      openGraph: { title: t('title'), description: t('desc') },
    };
  };
}
