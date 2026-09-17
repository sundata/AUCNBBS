import { getTranslations } from 'next-intl/server';

/**
 * Keyless map: OpenStreetMap embed iframe (no API key needed) plus a
 * "open in Google Maps" fallback link. Used where we only have lat/lng.
 */
export async function MapEmbed({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  const t = await getTranslations('map');
  const pad = 0.008;
  const bbox = `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return (
    <div className="space-y-1">
      <iframe
        title={label ?? t('title')}
        src={src}
        loading="lazy"
        className="h-64 w-full rounded-lg border border-gray-200"
      />
      <a href={gmaps} target="_blank" rel="noreferrer" className="text-xs text-brand underline">
        {t('openExternal')}
      </a>
    </div>
  );
}

/** Text-query variant for addresses without coordinates (venue/suburb strings). */
export async function MapLink({ query, label }: { query: string; label?: string }) {
  const t = await getTranslations('map');
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-xs text-brand underline">
      {label ?? t('viewOnMap')}
    </a>
  );
}
