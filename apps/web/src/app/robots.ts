import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/zh/admin',
        '/en/admin',
        '/zh/me',
        '/en/me',
        '/zh/messages',
        '/en/messages',
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
