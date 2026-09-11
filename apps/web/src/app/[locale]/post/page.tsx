import { setRequestLocale } from 'next-intl/server';
import { api, type BoardDto, type CityDto } from '@/lib/api';
import { first, type SearchParams } from '@/lib/server';
import { PublishForm } from '@/components/publish-form';

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const [cities, boards] = await Promise.all([
    api<CityDto[]>('/cities'),
    api<BoardDto[]>('/community/boards'),
  ]);
  return (
    <PublishForm
      cities={cities}
      boards={boards}
      initialType={first(sp.type)}
      initialBoard={first(sp.board)}
    />
  );
}
