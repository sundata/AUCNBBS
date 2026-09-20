import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/** Chinese-only product: legacy /en URLs permanently redirect to /zh. */
export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/en' || pathname.startsWith('/en/')) {
    const url = req.nextUrl.clone();
    url.pathname = `/zh${pathname.slice(3)}`;
    return NextResponse.redirect(url, 301);
  }
  return intl(req);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
