'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { writeAuth } from '@/lib/auth-client';
import { Link, useRouter } from '@/i18n/routing';

interface OAuthResult {
  accessToken?: string;
  expiresIn?: number;
  isNewUser?: boolean;
  mfaRequired?: boolean;
  ticket?: string;
}

export function OAuthCallback() {
  const started = useRef(false);
  const [error, setError] = useState('');
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
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
    void api<OAuthResult>('/auth/oauth/complete', {
      method: 'POST',
      body: JSON.stringify({ state: params.get('state'), code: params.get('code'), binding }),
    })
      .then((result) => {
        if (result.mfaRequired && result.ticket) {
          setMfaTicket(result.ticket);
          return;
        }
        if (!result.accessToken || !result.expiresIn) throw new Error(t('invalid'));
        writeAuth({
          accessToken: result.accessToken,
          expiresAt: Date.now() + result.expiresIn * 1000,
        });
        router.replace(result.isNewUser ? '/onboarding' : '/me');
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('invalid')));
  }, [router, t]);
  if (mfaTicket) {
    return (
      <form
        className="max-w-sm mx-auto space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          void api<OAuthResult>('/auth/mfa/complete', {
            method: 'POST',
            body: JSON.stringify({ ticket: mfaTicket, code }),
          })
            .then((result) => {
              if (!result.accessToken || !result.expiresIn) throw new Error(t('invalid'));
              writeAuth({
                accessToken: result.accessToken,
                expiresAt: Date.now() + result.expiresIn * 1000,
              });
              router.replace('/me');
            })
            .catch(() => setError(t('invalid')))
            .finally(() => setBusy(false));
        }}
      >
        <label className="block text-sm">
          <span className="text-muted">{t('mfaCode')}</span>
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            required
            autoFocus
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 tracking-widest"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button disabled={busy} className="rounded bg-brand text-white px-4 py-2 text-sm">
          {t('mfaVerify')}
        </button>
      </form>
    );
  }
  return error ? (
    <p role="alert">
      {error} <Link href="/login">{t('title')}</Link>
    </p>
  ) : (
    <p>{t('verifying')}</p>
  );
}
