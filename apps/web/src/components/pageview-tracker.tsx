'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { apiBase } from '@/lib/api';

/**
 * Fires an anonymous page-view beacon on every route change. Server filters
 * out admin/account paths; no cookies or identifiers are sent.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<string>('');
  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    try {
      void fetch(`${apiBase()}/api/v1/metrics/pageview`, {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: pathname, referrer: document.referrer || undefined }),
      });
    } catch {
      // analytics must never break the page
    }
  }, [pathname]);
  return null;
}
