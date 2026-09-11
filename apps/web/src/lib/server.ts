import { api, type CityDto } from './api';

export async function resolveCity(slug: string | undefined): Promise<CityDto | null> {
  if (!slug) return null;
  const cities = await api<CityDto[]>('/cities');
  return cities.find((c) => c.slug === slug) ?? null;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
