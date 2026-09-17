import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { TokenPair } from '../modules/auth/auth.service';

/**
 * W-1: browser sessions ride on httpOnly cookies so no token is readable by JS.
 * The access cookie is a fallback for server-driven requests; the web client
 * normally refreshes via POST /auth/refresh with the refresh cookie and keeps
 * the access token in memory only. Bearer tokens remain for native clients.
 *
 * CSRF: a readable `aucn_csrf` cookie holds a random token; mutating requests
 * authenticated via cookies must echo it in the `x-csrf-token` header
 * (double-submit). Bearer-authenticated requests are exempt.
 */
export const ACCESS_COOKIE = 'aucn_at';
export const REFRESH_COOKIE = 'aucn_rt';
export const CSRF_COOKIE = 'aucn_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const REFRESH_MAX_AGE_MS = 30 * 86_400_000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function cookieToken(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

function baseOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

export function setAuthCookies(res: Response, pair: TokenPair): void {
  res.cookie(ACCESS_COOKIE, pair.accessToken, {
    ...baseOpts(),
    maxAge: pair.expiresIn * 1000,
  });
  res.cookie(REFRESH_COOKIE, pair.refreshToken, { ...baseOpts(), maxAge: REFRESH_MAX_AGE_MS });
  res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
    ...baseOpts(),
    httpOnly: false, // JS must read it to echo the header (double-submit).
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, baseOpts());
  res.clearCookie(REFRESH_COOKIE, baseOpts());
  res.clearCookie(CSRF_COOKIE, { ...baseOpts(), httpOnly: false });
}

/** Double-submit check for cookie-authenticated mutations. */
export function csrfOk(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const expected = cookieToken(req, CSRF_COOKIE);
  const provided = req.headers[CSRF_HEADER];
  const token = Array.isArray(provided) ? provided[0] : provided;
  return !!expected && !!token && token === expected;
}
