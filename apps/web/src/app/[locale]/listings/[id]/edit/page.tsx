import { setRequestLocale } from 'next-intl/server';
import { EditListing } from '@/components/edit-listing';
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const p = await params;
  setRequestLocale(p.locale);
  return <EditListing id={p.id} />;
}
