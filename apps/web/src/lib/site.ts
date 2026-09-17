/** Canonical origin used for metadata, sitemap, and JSON-LD (W-10). */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export const LOCALE_MAP = { zh: 'zh-CN', en: 'en-AU' } as const;

/** hreflang alternates for a path that exists under both locales. */
export function localeAlternates(path: string) {
  return {
    canonical: `${siteUrl()}${path}`,
    languages: {
      'zh-CN': `${siteUrl()}/zh${path}`,
      'en-AU': `${siteUrl()}/en${path}`,
      'x-default': `${siteUrl()}/en${path}`,
    },
  };
}
