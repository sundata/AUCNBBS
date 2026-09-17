import { getTranslations, setRequestLocale } from 'next-intl/server';

const SECTIONS = ['collect', 'use', 'share', 'storage', 'rights', 'cookies', 'contact'] as const;

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('privacy');
  return (
    <article className="max-w-3xl mx-auto bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('updated')}</p>
      <p className="text-sm leading-7">{t('intro')}</p>
      {SECTIONS.map((key) => (
        <section key={key}>
          <h2 className="font-semibold mb-1">{t(`sections.${key}.title`)}</h2>
          <p className="text-sm leading-7 whitespace-pre-wrap">{t(`sections.${key}.body`)}</p>
        </section>
      ))}
    </article>
  );
}
