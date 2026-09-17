import { getTranslations, setRequestLocale } from 'next-intl/server';

const SECTIONS = [
  'acceptance',
  'accounts',
  'content',
  'prohibited',
  'moderation',
  'paid',
  'liability',
  'changes',
] as const;

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('terms');
  return (
    <article className="max-w-3xl mx-auto bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('updated')}</p>
      {SECTIONS.map((key) => (
        <section key={key}>
          <h2 className="font-semibold mb-1">{t(`sections.${key}.title`)}</h2>
          <p className="text-sm leading-7 whitespace-pre-wrap">{t(`sections.${key}.body`)}</p>
        </section>
      ))}
    </article>
  );
}
