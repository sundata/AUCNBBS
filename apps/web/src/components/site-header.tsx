'use client';

import {  useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import type { CityDto } from '@/lib/api';
import { useAuth } from '@/lib/auth-client';
import { cityName } from '@/lib/format';
import { CitySelect } from './city-select';

const NAV = [
  { href: '/', key: 'home' },
  { href: '/weekend', key: 'weekend' },
  { href: '/pulse', key: 'pulse' },
  { href: '/news', key: 'news' },
  { href: '/community', key: 'community' },
  { href: '/housing', key: 'housing' },
  { href: '/jobs', key: 'jobs' },
  { href: '/market', key: 'market' },
  { href: '/services', key: 'services' },
  { href: '/businesses', key: 'businesses' },
  { href: '/events', key: 'events' },
] as const;

export function SiteHeader({ cities }: { cities: CityDto[] }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { me, loading, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line shadow-[0_1px_0_rgba(18,48,74,0.04)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 py-3 sm:h-[4.5rem] sm:flex-nowrap sm:py-0">
          <Link
            href="/"
            className="shrink-0 text-xl sm:text-2xl font-semibold tracking-tight text-navy whitespace-nowrap"
          >
            澳中生活圈
          </Link>
          <div className="hidden sm:block shrink-0">
            <CitySelect cities={cities} />
          </div>
          <form
            action="/zh/search"
            className="order-3 flex w-full sm:order-none sm:flex-1 sm:min-w-40"
          >
            <input
              name="q"
              type="search"
              placeholder={t('search')}
              className="w-full rounded-l-lg border border-line bg-white px-3 py-2 text-sm placeholder:text-muted/80 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <button
              type="submit"
              className="rounded-r-lg bg-brand text-white px-3 sm:px-4 text-sm font-medium whitespace-nowrap shrink-0 hover:bg-brand-dark"
            >
              {t('search')}
            </button>
          </form>
          <nav className="flex items-center gap-2 sm:gap-3 text-sm ml-auto min-w-0">
            <Link
              href="/post"
              className="rounded-lg bg-coral text-white px-3 py-2 font-medium shadow-sm hover:bg-coral-dark hover:-translate-y-px"
            >
              <span className="sm:hidden">+</span>
              <span className="hidden sm:inline">+ {t('post')}</span>
            </Link>
            {loading ? null : me ? (
              <>
                <Link href="/messages" className="hidden lg:inline hover:text-brand">
                  {t('messages')}
                </Link>
                {['editor', 'moderator', 'admin', 'super_admin'].includes(me.role) && (
                  <Link href="/admin" className="hidden lg:inline hover:text-brand">
                    {t('admin')}
                  </Link>
                )}
                <Link href="/me" className="max-w-24 truncate hover:text-brand">
                  {me.displayName}
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="hidden sm:inline text-muted hover:text-brand"
                >
                  {t('logout')}
                </button>
              </>
            ) : (
              <Link href="/login" className="hover:text-brand whitespace-nowrap">
                {t('login')}
              </Link>
            )}
          </nav>
        </div>
        <div className="sm:hidden pb-2">
          <CitySelect cities={cities} />
        </div>
        <nav className="flex gap-1 overflow-x-auto text-sm -mb-px scrollbar-none">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`px-3 py-2.5 border-b-2 whitespace-nowrap ${active ? 'border-brand text-brand font-medium' : 'border-transparent text-muted hover:text-brand'}`}
              >
                {t(item.key)}
              </Link>
            );
          })}
          {cities.length > 0 && (
            <span className="ml-auto py-2 text-muted hidden sm:inline">
              {cities
                .filter((c) => c.isLaunch)
                .map((c) => cityName(c))
                .join(' · ')}
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
