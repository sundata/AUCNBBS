'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

const KEY = 'aucn.auth';

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function readAuth(): StoredAuth | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function writeAuth(auth: StoredAuth | null): void {
  if (auth) window.localStorage.setItem(KEY, JSON.stringify(auth));
  else window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('aucn-auth'));
}

let refreshInFlight: Promise<string | null> | null = null;

export async function getAccessToken(): Promise<string | null> {
  const auth = readAuth();
  if (!auth) return null;
  if (auth.expiresAt - 30_000 > Date.now()) return auth.accessToken;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAccessToken(auth);
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function refreshAccessToken(auth: StoredAuth): Promise<string | null> {
  try {
    const t = await api<{ accessToken: string; refreshToken: string; expiresIn: number }>(
      '/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      },
    );
    writeAuth({
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: Date.now() + t.expiresIn * 1000,
    });
    return t.accessToken;
  } catch {
    writeAuth(null);
    return null;
  }
}

export interface Me {
  id: string;
  displayName: string;
  role: string;
  email: string | null;
}

export function useAuth(): { me: Me | null; loading: boolean; logout: () => Promise<void> } {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/me', { token }));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener('aucn-auth', load);
    return () => window.removeEventListener('aucn-auth', load);
  }, [load]);

  const logout = useCallback(async () => {
    const auth = readAuth();
    if (auth) {
      try {
        await api('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        });
      } catch {
        // best effort
      }
    }
    writeAuth(null);
  }, []);

  return { me, loading, logout };
}
