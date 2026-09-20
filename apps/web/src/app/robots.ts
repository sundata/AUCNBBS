import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/zh/admin', '/zh/me', '/zh/messages'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
