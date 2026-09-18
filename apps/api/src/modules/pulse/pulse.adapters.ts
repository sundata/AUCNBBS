import { z } from 'zod';
import type { feedItemInput } from './pulse.helpers';
import { fetchFeed } from '../weekend/feed-fetch';

export interface AdapterResult {
  metrics?: { kind: string; payload: Record<string, unknown> }[];
  items?: z.infer<typeof feedItemInput>[];
}

const frankfurter = z.object({
  base: z.string(),
  date: z.string(),
  rates: z.record(z.number()),
});

/** Frankfurter (ECB reference rates). URL: https://api.frankfurter.dev/v1/latest?base=AUD&symbols=CNY */
async function runFrankfurter(url: string): Promise<AdapterResult> {
  const data = frankfurter.parse(JSON.parse(await fetchFeed(url)));
  return {
    metrics: [
      {
        kind: 'exchange_rate',
        payload: { base: data.base, date: data.date, rates: data.rates },
      },
    ],
  };
}

const openMeteo = z.object({
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number().optional(),
    weather_code: z.number(),
    wind_speed_10m: z.number().optional(),
    relative_humidity_2m: z.number().optional(),
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number()).optional(),
    uv_index_max: z.array(z.number()).optional(),
  }),
});

/** Open-Meteo forecast (free, keyless). URL contains lat/lng of the city. */
async function runOpenMeteo(url: string): Promise<AdapterResult> {
  const data = openMeteo.parse(JSON.parse(await fetchFeed(url)));
  const days = data.daily.time.slice(0, 7).map((d, i) => ({
    date: d,
    code: data.daily.weather_code[i],
    max: data.daily.temperature_2m_max[i],
    min: data.daily.temperature_2m_min[i],
    rainChance: data.daily.precipitation_probability_max?.[i] ?? null,
    uv: data.daily.uv_index_max?.[i] ?? null,
  }));
  return {
    metrics: [
      {
        kind: 'weather',
        payload: {
          current: {
            temp: data.current.temperature_2m,
            feels: data.current.apparent_temperature ?? null,
            code: data.current.weather_code,
            wind: data.current.wind_speed_10m ?? null,
            humidity: data.current.relative_humidity_2m ?? null,
          },
          daily: days,
        },
      },
    ],
  };
}

const fuelCheck = z.object({
  stations: z
    .array(
      z.object({
        name: z.string(),
        address: z.string().optional(),
        price: z.number(),
        fueltype: z.string().optional(),
      }),
    )
    .default([]),
});

/** NSW FuelCheck-style JSON. Free registration required; adapter skipped without a configured URL. */
async function runFuelCheck(url: string): Promise<AdapterResult> {
  const data = fuelCheck.parse(JSON.parse(await fetchFeed(url)));
  const cheapest = data.stations
    .filter((s) => s.price > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);
  return {
    metrics: [{ kind: 'fuel', payload: { stations: cheapest } }],
  };
}

export const ADAPTERS: Record<string, (url: string) => Promise<AdapterResult>> = {
  frankfurter: runFrankfurter,
  openmeteo: runOpenMeteo,
  fuelcheck: runFuelCheck,
};
