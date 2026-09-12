'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, type ListingDetail, type CityDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { Link } from '@/i18n/routing';
import { PublishForm } from './publish-form';
import { ListingImages } from './listing-images';
export function EditListing({ id }: { id: string }) {
  const { me, loading } = useAuth();
  const t = useTranslations('listing');
  const [data, setData] = useState<{ listing: ListingDetail; cities: CityDto[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!me) return;
    let active = true;
    void (async () => {
      const token = await getAccessToken();
      const [listing, cities] = await Promise.all([
        api<ListingDetail>(`/listings/${id}`, { token }),
        api<CityDto[]>('/cities'),
      ]);
      if (active) setData({ listing, cities });
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : t('loadError'));
    });
    return () => {
      active = false;
    };
  }, [me, id, t]);
  if (loading) return <p>{t('loading')}</p>;
  if (!me) return <Link href={`/login?next=/listings/${id}/edit`}>{t('loginEdit')}</Link>;
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>{t('loading')}</p>;
  if (data.listing.owner.id !== me.id) return <p>{t('notOwner')}</p>;
  return (
    <div className="space-y-4">
      <PublishForm cities={data.cities} boards={[]} initialListing={data.listing} />
      <ListingImages listingId={id} />
    </div>
  );
}
