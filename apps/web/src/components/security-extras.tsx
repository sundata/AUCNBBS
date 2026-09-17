'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';

const urlB64ToUint8Array = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const PREF_KEYS = ['interactions', 'transactions', 'system', 'marketing'] as const;
type PrefKey = (typeof PREF_KEYS)[number];

/** MFA (TOTP) enrolment + notification preferences + blocked users + invoices. */
export function SecurityExtras() {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const { me } = useAuth();
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    interactions: true,
    transactions: true,
    system: true,
    marketing: false,
  });
  const [passkeys, setPasskeys] = useState<{ id: string; name: string | null }[]>([]);
  const [pushOn, setPushOn] = useState(false);
  const [blocked, setBlocked] = useState<{ user: { id: string; displayName: string } }[]>([]);
  const [invoices, setInvoices] = useState<
    { id: string; number: string; amountMinor: number; currency: string; issuedAt: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!me) return;
    const p = (me.notificationPrefs ?? {}) as Record<string, { inapp?: boolean } | undefined>;
    setPrefs((cur) => ({
      ...cur,
      ...Object.fromEntries(PREF_KEYS.map((k) => [k, p[k]?.inapp ?? cur[k]])),
    }));
    void (async () => {
      const token = await getAccessToken();
      const [b, inv, pk] = await Promise.all([
        api<{ items: { user: { id: string; displayName: string } }[] }>('/messages/blocks', {
          token,
        }),
        api<{ items: typeof invoices }>('/me/invoices', { token }),
        api<{ items: { id: string; name: string | null }[] }>('/auth/passkey', { token }),
      ]);
      setBlocked(b.items);
      setInvoices(inv.items);
      setPasskeys(pk.items);
    })().catch(() => undefined);
    if ('serviceWorker' in navigator && 'PushManager' in window)
      void navigator.serviceWorker
        .getRegistration('/sw.js')
        .then(async (reg) => setPushOn(!!(await reg?.pushManager.getSubscription())))
        .catch(() => undefined);
  }, [me]);

  const addPasskey = async () => {
    const token = await getAccessToken();
    const { options, ticket } = await api<{
      options: PublicKeyCredentialCreationOptionsJSON;
      ticket: string;
    }>('/auth/passkey/register/options', { method: 'POST', token, body: JSON.stringify({}) });
    const response = await startRegistration({ optionsJSON: options });
    await api('/auth/passkey/register', {
      method: 'POST',
      token,
      body: JSON.stringify({ ticket, response }),
    });
    setPasskeys((rows) => [...rows, { id: response.id, name: 'Passkey' }]);
    setMsg(t('passkeyAdded'));
  };

  const togglePush = async (enable: boolean) => {
    const token = await getAccessToken();
    if (enable) {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        ...(process.env.NEXT_PUBLIC_VAPID_KEY
          ? {
              applicationServerKey: urlB64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_KEY)
                .buffer as ArrayBuffer,
            }
          : {}),
      });
      const json = sub.toJSON();
      await api('/me/push-subscriptions', {
        method: 'POST',
        token,
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      setPushOn(true);
    } else {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api('/me/push-subscriptions', {
          method: 'DELETE',
          token,
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushOn(false);
    }
  };

  if (!me) return null;
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : tc('error'));

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      <h2 className="font-semibold">{t('extrasTitle')}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}

      {/* MFA */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('mfaTitle')}</h3>
        {me.totpEnabled ? (
          <p className="text-sm">
            <span className="text-green-700">{t('mfaOn')}</span>{' '}
            <button
              className="text-red-600 underline text-xs"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  const code = window.prompt(t('mfaDisablePrompt')) ?? '';
                  if (!code) return;
                  await api('/auth/mfa/disable', {
                    method: 'POST',
                    token: await getAccessToken(),
                    body: JSON.stringify({ code }),
                  });
                  window.dispatchEvent(new Event('aucn-auth'));
                })().catch(fail)
              }
            >
              {t('mfaDisable')}
            </button>
          </p>
        ) : totpSetup ? (
          <form
            className="space-y-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void (async () => {
                await api('/auth/mfa/enable', {
                  method: 'POST',
                  token: await getAccessToken(),
                  body: JSON.stringify({ code: totpCode }),
                });
                setTotpSetup(null);
                setMsg(t('mfaEnabled'));
                window.dispatchEvent(new Event('aucn-auth'));
              })()
                .catch(fail)
                .finally(() => setBusy(false));
            }}
          >
            <p>
              {t('mfaScanHint')} <code className="break-all">{totpSetup.uri}</code>
            </p>
            <p>
              {t('mfaSecret')}: <code>{totpSetup.secret}</code>
            </p>
            <input
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="border rounded px-2 py-1 tracking-widest"
            />
            <button disabled={busy} className="bg-brand text-white rounded px-3 py-1 ml-2">
              {t('mfaEnable')}
            </button>
          </form>
        ) : (
          <button
            className="text-sm text-brand underline"
            onClick={() =>
              void (async () => {
                setTotpSetup(
                  await api<{ secret: string; uri: string }>('/auth/mfa/setup', {
                    method: 'POST',
                    token: await getAccessToken(),
                  }),
                );
              })().catch(fail)
            }
          >
            {t('mfaSetup')}
          </button>
        )}
      </div>

      {/* Passkeys */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('passkeyTitle')}</h3>
        <ul className="text-sm space-y-1">
          {passkeys.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{p.name ?? 'Passkey'}</span>
              <button
                className="text-xs text-red-600 underline"
                onClick={() =>
                  void (async () => {
                    await api(`/auth/passkey/${p.id}`, {
                      method: 'DELETE',
                      token: await getAccessToken(),
                    });
                    setPasskeys((rows) => rows.filter((r) => r.id !== p.id));
                  })().catch(fail)
                }
              >
                {tc('delete')}
              </button>
            </li>
          ))}
        </ul>
        <button
          className="text-sm text-brand underline"
          onClick={() => void addPasskey().catch(fail)}
        >
          {t('passkeyAdd')}
        </button>
      </div>

      {/* Push notifications */}
      {'serviceWorker' in navigator && 'PushManager' in window && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('pushTitle')}</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pushOn}
              onChange={(e) => void togglePush(e.target.checked).catch(fail)}
            />
            {t('pushEnable')}
          </label>
        </div>
      )}

      {/* Notification preferences */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('prefsTitle')}</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {PREF_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={prefs[k]}
                onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))}
              />
              {t(`pref.${k}`)}
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={me.marketingOptOut}
              onChange={(e) =>
                void (async () => {
                  await api('/me', {
                    method: 'PATCH',
                    token: await getAccessToken(),
                    body: JSON.stringify({ marketingOptOut: e.target.checked }),
                  });
                  window.dispatchEvent(new Event('aucn-auth'));
                })().catch(fail)
              }
            />
            {t('pref.marketingOptOut')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={me.personalizationOff}
              onChange={(e) =>
                void (async () => {
                  await api('/me', {
                    method: 'PATCH',
                    token: await getAccessToken(),
                    body: JSON.stringify({ personalizationOff: e.target.checked }),
                  });
                  window.dispatchEvent(new Event('aucn-auth'));
                })().catch(fail)
              }
            />
            {t('pref.personalizationOff')}
          </label>
        </div>
        <button
          className="text-sm bg-brand text-white rounded px-3 py-1"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              const body = Object.fromEntries(
                PREF_KEYS.map((k) => [k, { inapp: prefs[k], push: prefs[k] }]),
              );
              await api('/me/notification-prefs', {
                method: 'PUT',
                token: await getAccessToken(),
                body: JSON.stringify(body),
              });
              setMsg(t('prefsSaved'));
            })()
              .catch(fail)
              .finally(() => setBusy(false))
          }
        >
          {t('prefsSave')}
        </button>
      </div>

      {/* Blocked users */}
      {blocked.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('blockedTitle')}</h3>
          <ul className="text-sm divide-y">
            {blocked.map((b) => (
              <li key={b.user.id} className="py-1 flex justify-between">
                <span>{b.user.displayName}</span>
                <button
                  className="text-xs text-brand underline"
                  onClick={() =>
                    void (async () => {
                      await api(`/messages/blocks/${b.user.id}`, {
                        method: 'DELETE',
                        token: await getAccessToken(),
                      });
                      setBlocked((rows) => rows.filter((r) => r.user.id !== b.user.id));
                    })().catch(fail)
                  }
                >
                  {t('unblock')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('invoicesTitle')}</h3>
          <ul className="text-sm divide-y">
            {invoices.map((i) => (
              <li key={i.id} className="py-1 flex justify-between">
                <span>{i.number}</span>
                <span>
                  {(i.amountMinor / 100).toFixed(2)} {i.currency} ·{' '}
                  {new Date(i.issuedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
