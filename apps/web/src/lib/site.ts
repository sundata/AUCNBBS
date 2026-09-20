/** Canonical origin used for metadata, sitemap, and JSON-LD (W-10). */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export const LOCALE_MAP = { zh: 'zh-CN' } as const;

/** Chinese-only product: canonical points at the zh URL. */
export function localeAlternates(path: string) {
  return {
    canonical: `${siteUrl()}/zh${path}`,
    languages: {
      'zh-CN': `${siteUrl()}/zh${path}`,
      'x-default': `${siteUrl()}/zh${path}`,
    },
  };
}
