import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { api, type CityDto } from '@/lib/api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { siteUrl } from '@/lib/site';
import '../globals.css';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'site' });
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: `${t('name')}｜${t('tagline')}`, template: `%s · ${t('name')}` },
    description: t('tagline'),
    keywords: t('keywords')
      .split(',')
      .map((k) => k.trim()),
    alternates: { canonical: `${siteUrl()}/zh` },
    openGraph: {
      siteName: t('name'),
      locale: 'zh_CN',
      type: 'website',
      url: `${siteUrl()}/zh`,
      title: t('name'),
      description: t('tagline'),
    },
    twitter: { card: 'summary_large_image', title: t('name'), description: t('tagline') },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  let cities: CityDto[] = [];
  try {
    cities = await api<CityDto[]>('/cities');
  } catch {
    cities = [];
  }
  return (
    <html lang="zh-CN">
      <body className="min-h-screen flex flex-col bg-surface">
        <NextIntlClientProvider>
          <SiteHeader cities={cities} />
          <main className="min-w-0 flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
            {children}
          </main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
