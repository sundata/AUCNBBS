'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/api';
import { AlternateLogin } from './alternate-login';
import { writeAuth } from '@/lib/auth-client';

interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  isNewUser: boolean;
  mfaRequired?: boolean;
  ticket?: string;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'mfa'>('email');
  const [ttl, setTtl] = useState(10);
  const [mfaTicket, setMfaTicket] = useState('');
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
      if (r.mfaRequired && r.ticket) {
        setMfaTicket(r.ticket);
        setCode('');
        setStep('mfa');
        return;
      }
      writeAuth({ accessToken: r.accessToken, expiresAt: Date.now() + r.expiresIn * 1000 });
      const next = sp.get('next');
      // New accounts land on onboarding to pick language/city/interests (§5.1).
      if (r.isNewUser) router.push('/onboarding');
      else router.push(next && /^\/(?![\/\\])/.test(next) ? next : '/');
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

  async function verifyMfa() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<TokenResponse>('/auth/mfa/complete', {
        method: 'POST',
        body: JSON.stringify({ ticket: mfaTicket, code }),
      });
      writeAuth({ accessToken: r.accessToken, expiresAt: Date.now() + r.expiresIn * 1000 });
      router.push('/');
    } catch (e) {
      setError(e instanceof ApiError ? t('invalid') : tc('error'));
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
          void (step === 'email' ? request() : step === 'code' ? verify() : verifyMfa());
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
        {step === 'mfa' && (
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
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-brand text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {step === 'email' ? t('sendCode') : step === 'mfa' ? t('mfaVerify') : t('verify')}
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
      <AlternateLogin />
    </div>
  );
}
