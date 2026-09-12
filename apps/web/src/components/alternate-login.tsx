'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { writeAuth } from '@/lib/auth-client';
import { useRouter } from '@/i18n/routing';
export function AlternateLogin() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [providers, setProviders] = useState<{ oauth: string[]; phone: boolean }>({
    oauth: [],
    phone: false,
  });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<typeof providers>('/auth/providers')
      .then(setProviders)
      .catch(() => {});
  }, []);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : t('invalid'));
  return (
    <div className="space-y-3 mt-4">
      {providers.oauth.map((provider) => (
        <button
          key={provider}
          disabled={busy}
          className="block border rounded p-2 w-full"
          onClick={() => {
            setBusy(true);
            void (async () => {
              const binding = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
                b.toString(16).padStart(2, '0'),
              ).join('');
              sessionStorage.setItem('aucn.oauth.binding', binding);
              const result = await api<{ url: string }>('/auth/oauth/start', {
                method: 'POST',
                body: JSON.stringify({ provider, locale, binding }),
              });
              window.location.assign(result.url);
            })()
              .catch(fail)
              .finally(() => setBusy(false));
          }}
        >
          {t('continueWith', { provider })}
        </button>
      ))}
      {providers.phone && (
        <form
          className="border-t pt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            void (async () => {
              if (!sent) {
                await api('/auth/phone/request', {
                  method: 'POST',
                  body: JSON.stringify({ phone }),
                });
                setSent(true);
              } else {
                const result = await api<{
                  accessToken: string;
                  refreshToken: string;
                  expiresIn: number;
                }>('/auth/phone/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });
                writeAuth({ ...result, expiresAt: Date.now() + result.expiresIn * 1000 });
                router.push('/me');
              }
            })()
              .catch(fail)
              .finally(() => setBusy(false));
          }}
        >
          <label>
            {t('phone')}
            <input
              type="tel"
              placeholder="+61412345678"
              required
              disabled={sent}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="border p-2 w-full"
            />
          </label>
          {sent && (
            <label>
              {t('code')}
              <input
                required
                pattern="[0-9]{6}"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="border p-2 w-full"
              />
            </label>
          )}
          <button disabled={busy} className="border rounded p-2">
            {sent ? t('verify') : t('sendCode')}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
