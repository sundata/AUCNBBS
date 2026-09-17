import { setRequestLocale } from 'next-intl/server';
import { AccountPanel } from '@/components/account-panel';
import { FavoritesPanel } from '@/components/favorites-panel';
import { MePanel } from '@/components/me-panel';
import { SecurityExtras } from '@/components/security-extras';

export default async function MePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <MePanel />
      <FavoritesPanel />
      <AccountPanel />
      <SecurityExtras />
    </div>
  );
}
