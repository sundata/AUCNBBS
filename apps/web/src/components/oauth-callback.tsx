'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { writeAuth } from '@/lib/auth-client';
import { Link, useRouter } from '@/i18n/routing';
export function OAuthCallback() {
  const started = useRef(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const t = useTranslations('auth');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    history.replaceState(null, '', window.location.pathname);
    const binding = sessionStorage.getItem('aucn.oauth.binding');
    sessionStorage.removeItem('aucn.oauth.binding');
    if (params.has('error') || !binding) {
      setError(t('invalid'));
      return;
    }
    void api<{ accessToken: string; refreshToken: string; expiresIn: number }>(
      '/auth/oauth/complete',
      {
        method: 'POST',
        body: JSON.stringify({ state: params.get('state'), code: params.get('code'), binding }),
      },
    )
      .then((result) => {
        writeAuth({ ...result, expiresAt: Date.now() + result.expiresIn * 1000 });
        router.replace('/me');
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('invalid')));
  }, [router, t]);
  return error ? (
    <p role="alert">
      {error} <Link href="/login">{t('title')}</Link>
    </p>
  ) : (
    <p>{t('verifying')}</p>
  );
}
