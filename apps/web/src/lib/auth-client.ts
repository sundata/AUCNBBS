'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/**
 * W-1: no long-lived token in localStorage. The refresh token lives in an
 * httpOnly cookie set by the API; the short-lived access token is kept in
 * module memory only and re-minted via POST /auth/refresh (cookie) on load
 * and expiry.
 */
interface MemAuth {
  accessToken: string;
  expiresAt: number;
}

let memAuth: MemAuth | null = null;
let refreshInFlight: Promise<string | null> | null = null;

/** Kept for call-site compatibility: stores only the access token in memory. */
export interface StoredAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export function readAuth(): StoredAuth | null {
  return memAuth ? { accessToken: memAuth.accessToken, expiresAt: memAuth.expiresAt } : null;
}

export function writeAuth(auth: StoredAuth | null): void {
  memAuth = auth ? { accessToken: auth.accessToken, expiresAt: auth.expiresAt } : null;
  window.dispatchEvent(new Event('aucn-auth'));
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    // No body: the API reads the httpOnly refresh cookie.
    const t = await api<{ accessToken: string; refreshToken?: string; expiresIn: number }>(
      '/auth/refresh',
      { method: 'POST', body: JSON.stringify({}) },
    );
    memAuth = { accessToken: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 };
    return t.accessToken;
  } catch {
    memAuth = null;
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (memAuth && memAuth.expiresAt - 30_000 > Date.now()) return memAuth.accessToken;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAccessToken();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export interface Me {
  id: string;
  displayName: string;
  role: string;
  locale: string;
  bio: string | null;
  homeCityId: string | null;
  email: string | null;
  interests: string[];
  avatarMediaId: string | null;
  birthYear: number | null;
  totpEnabled: boolean;
  notificationPrefs: Record<string, unknown> | null;
  marketingOptOut: boolean;
  personalizationOff: boolean;
  onboardedAt: string | null;
  deletionRequestedAt: string | null;
  createdAt: string;
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
    try {
      await api('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // best effort — cookies are cleared server-side regardless
    }
    memAuth = null;
    window.dispatchEvent(new Event('aucn-auth'));
  }, []);

  return { me, loading, logout };
}
