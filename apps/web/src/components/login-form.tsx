'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/api';
import { writeAuth } from '@/lib/auth-client';

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  isNewUser: boolean;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [ttl, setTtl] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ttlSeconds: number }>('/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setTtl(Math.round(r.ttlSeconds / 60));
      setStep('code');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('error'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<TokenResponse>('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      });
      writeAuth({
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        expiresAt: Date.now() + r.expiresIn * 1000,
      });
      const next = sp.get('next');
      router.push(next && next.startsWith('/') ? next : '/');
    } catch (e) {
      setError(
        e instanceof ApiError && e.problem.status === 401
          ? t('invalid')
          : e instanceof ApiError
            ? e.message
            : tc('error'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto bg-white rounded-lg border border-gray-200 p-6">
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <p className="text-sm text-muted mt-1 mb-4">{t('subtitle')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (step === 'email' ? request() : verify());
        }}
        className="space-y-3"
      >
        <label className="block text-sm">
          <span className="text-muted">{t('email')}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            disabled={step === 'code'}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-50"
          />
        </label>
        {step === 'code' && (
          <>
            <p className="text-xs text-green-700">{t('sent', { ttl })}</p>
            <label className="block text-sm">
              <span className="text-muted">{t('code')}</span>
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
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-brand text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {step === 'email' ? t('sendCode') : t('verify')}
        </button>
        {step === 'code' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void request()}
            className="w-full text-xs text-muted hover:text-brand"
          >
            {t('resend')}
          </button>
        )}
      </form>
    </div>
  );
}
