import { cookies } from 'next/headers';

/**
 * W-1: forward the browser's httpOnly access cookie to the API as a Bearer
 * token when rendering on the server, so SSR sees the same identity.
 */
export async function serverToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get('aucn_at')?.value;
}
