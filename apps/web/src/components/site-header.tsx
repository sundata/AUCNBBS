'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname, useRouter, type AppLocale } from '@/i18n/routing';
import type { CityDto } from '@/lib/api';
import { useAuth } from '@/lib/auth-client';
import { cityName } from '@/lib/format';
import { CitySelect } from './city-select';

const NAV = [
  { href: '/', key: 'home' },
  { href: '/news', key: 'news' },
  { href: '/community', key: 'community' },
  { href: '/housing', key: 'housing' },
  { href: '/jobs', key: 'jobs' },
  { href: '/market', key: 'market' },
  { href: '/services', key: 'services' },
] as const;

export function SiteHeader({ cities }: { cities: CityDto[] }) {
  const t = useTranslations('nav');
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const { me, loading, logout } = useAuth();
  const otherLocale: AppLocale = locale === 'zh' ? 'en' : 'zh';
  const query = search.toString();

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center gap-4 h-14">
          <Link href="/" className="text-xl font-bold text-brand whitespace-nowrap">
            {locale === 'zh' ? '澳中生活圈' : 'AUCN Hub'}
          </Link>
          <CitySelect cities={cities} />
          <form action={`/${locale}/search`} className="flex-1 hidden md:flex">
            <input
              name="q"
              type="search"
              placeholder={t('search')}
              className="w-full rounded-l border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:border-brand"
            />
            <button
              type="submit"
              className="rounded-r bg-brand text-white px-3 text-sm whitespace-nowrap shrink-0"
            >
              {t('search')}
            </button>
          </form>
          <nav className="flex items-center gap-3 text-sm ml-auto">
            <Link
              href="/post"
              className="rounded bg-brand text-white px-3 py-1.5 font-medium hover:bg-brand-dark"
            >
              + {t('post')}
            </Link>
            {loading ? null : me ? (
              <>
                <Link href="/messages">{t('messages')}</Link>
                {['editor', 'moderator', 'admin', 'super_admin'].includes(me.role) && (
                  <Link href="/admin">{t('admin')}</Link>
                )}
                <Link href="/me" className="hover:text-brand">
                  {me.displayName}
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="text-muted hover:text-brand"
                >
                  {t('logout')}
                </button>
              </>
            ) : (
              <Link href="/login" className="hover:text-brand">
                {t('login')}
              </Link>
            )}
            <button
              type="button"
              className="text-muted hover:text-brand border border-gray-300 rounded px-2 py-0.5"
              onClick={() =>
                router.replace(`${pathname}${query ? `?${query}` : ''}`, { locale: otherLocale })
              }
            >
              {t('switchLocale')}
            </button>
          </nav>
        </div>
        <nav className="flex gap-1 overflow-x-auto text-sm -mb-px">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`px-3 py-2 border-b-2 whitespace-nowrap ${active ? 'border-brand text-brand font-medium' : 'border-transparent hover:text-brand'}`}
              >
                {t(item.key)}
              </Link>
            );
          })}
          {cities.length > 0 && (
            <span className="ml-auto py-2 text-muted hidden sm:inline">
              {cities
                .filter((c) => c.isLaunch)
                .map((c) => cityName(c, locale))
                .join(' · ')}
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
