/**
 * Structured-signal extraction from collected feed posts.
 * Turns raw forum text into original data: asking prices and locations.
 */

export type PricePeriod = 'week' | 'hour' | 'day' | 'once';

const num = (s: string) => parseInt(s.replace(/,/g, ''), 10);

const WEEKLY: RegExp[] = [
  /\$\s?(\d{3,4})\s?(?:\/\s?(?:w|wk|week|周)|pw|p\.?w\.?|per\s?week|每周|一周|\/周)/i,
  /(?:周租|每周|每周租金|租金|房租|rent)\s*[:：]?\s*\$?\s?(\d{3,4})/i,
  /(\d{3,4})\s?(?:刀|aud|澳元|澳币|块)?\s?(?:\/|每)(?:周|week)/i,
];
const HOURLY: RegExp[] = [
  /\$\s?(\d{2,3})\s?(?:\/\s?(?:h|hr|hrs|hour|小时)|per\s?hour|每小时)/i,
  /时薪\s*[:：]?\s*\$?\s?(\d{2,3})/,
  /(\d{2,3})\s?(?:刀|aud|澳元|澳币|块)?\s?(?:\/|每)小时/,
];
const DAILY: RegExp[] = [
  /\$\s?(\d{2,4})\s?(?:\/\s?(?:day|天)|per\s?day|每天|\/天)/i,
  /日薪\s*[:：]?\s*\$?\s?(\d{2,4})/,
];
const ONCE: RegExp[] = [/\$\s?(\d{1,3}(?:,\d{3})+|\d{2,6})(?!\s?(?:\/|per|每|刀?\/))/];

const RANGES: Record<PricePeriod, [number, number]> = {
  week: [50, 5000],
  hour: [10, 300],
  day: [50, 3000],
  once: [5, 900000],
};

/** First plausible asking price in the text. Period-specific patterns win. */
export function extractPrice(text: string): { cents: number; period: PricePeriod } | null {
  for (const [period, patterns] of [
    ['week', WEEKLY],
    ['hour', HOURLY],
    ['day', DAILY],
  ] as const) {
    for (const re of patterns) {
      const m = re.exec(text);
      if (!m) continue;
      const v = num(m[1]);
      const [lo, hi] = RANGES[period];
      if (v >= lo && v <= hi) return { cents: v * 100, period };
    }
  }
  for (const re of ONCE) {
    const m = re.exec(text);
    if (!m) continue;
    const v = num(m[1]);
    const [lo, hi] = RANGES.once;
    if (v >= lo && v <= hi) return { cents: v * 100, period: 'once' };
  }
  return null;
}

/**
 * Known Australian suburbs/cities with large Chinese communities.
 * Longer names are matched first so "Glen Waverley" beats nothing partial.
 */
const LOCATIONS = [
  // Sydney
  'Eastwood',
  'Burwood',
  'Hurstville',
  'Chatswood',
  'Rhodes',
  'Ashfield',
  'Auburn',
  'Parramatta',
  'Epping',
  'Carlingford',
  'Strathfield',
  'Bankstown',
  'Campsie',
  'Zetland',
  'Mascot',
  'Haymarket',
  'Hornsby',
  'Macquarie Park',
  'North Sydney',
  'Sydney',
  '悉尼',
  '宝活',
  '好市围',
  '车士活',
  // Melbourne
  'Glen Waverley',
  'Box Hill',
  'Clayton',
  'Doncaster',
  'Carlton',
  'Docklands',
  'Footscray',
  'Springvale',
  'Caulfield',
  'Melbourne',
  '墨尔本',
  '博士山',
  // Brisbane / Perth / Adelaide / others
  'Sunnybank',
  'Eight Mile Plains',
  'Brisbane',
  '布里斯班',
  'Perth',
  '珀斯',
  'Adelaide',
  '阿德莱德',
  'Canberra',
  '堪培拉',
  'Gold Coast',
  '黄金海岸',
  'Townsville',
];

const CANONICAL: Record<string, string> = {
  悉尼: 'Sydney',
  墨尔本: 'Melbourne',
  布里斯班: 'Brisbane',
  珀斯: 'Perth',
  阿德莱德: 'Adelaide',
  堪培拉: 'Canberra',
  黄金海岸: 'Gold Coast',
  宝活: 'Burwood',
  好市围: 'Hurstville',
  车士活: 'Chatswood',
  博士山: 'Box Hill',
};

const LOCATION_RE = new RegExp(
  `(${[...LOCATIONS].sort((a, b) => b.length - a.length).join('|')})`,
  'i',
);

export function extractLocation(text: string): string | null {
  const m = LOCATION_RE.exec(text);
  if (!m) return null;
  return CANONICAL[m[1]] ?? m[1][0].toUpperCase() + m[1].slice(1);
}
