import * as SecureStore from 'expo-secure-store';
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt?: number;
}
let refresh: Promise<string | null> | null = null;
export async function saveTokens(value: Tokens | null) {
  if (value)
    await SecureStore.setItemAsync(
      'aucn.auth',
      JSON.stringify({ ...value, expiresAt: Date.now() + value.expiresIn * 1000 }),
    );
  else await SecureStore.deleteItemAsync('aucn.auth');
}
export async function accessToken(): Promise<string | null> {
  const raw = await SecureStore.getItemAsync('aucn.auth');
  if (!raw) return null;
  const value = JSON.parse(raw) as Tokens;
  if ((value.expiresAt ?? 0) > Date.now() + 30000) return value.accessToken;
  if (!refresh)
    refresh = (async () => {
      try {
        const next = await request<Tokens>(
          '/auth/refresh',
          { method: 'POST', body: JSON.stringify({ refreshToken: value.refreshToken }) },
          false,
        );
        await saveTokens(next);
        return next.accessToken;
      } catch {
        await saveTokens(null);
        return null;
      } finally {
        refresh = null;
      }
    })();
  return refresh;
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const token = authenticated ? await accessToken() : null;
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ title: 'Request failed' }));
    throw new Error(error.detail ?? error.title ?? 'Request failed');
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}
export async function logout() {
  const raw = await SecureStore.getItemAsync('aucn.auth');
  try {
    if (raw)
      await request(
        '/auth/logout',
        {
          method: 'POST',
          body: JSON.stringify({ refreshToken: (JSON.parse(raw) as Tokens).refreshToken }),
        },
        false,
      );
  } finally {
    await saveTokens(null);
  }
}
