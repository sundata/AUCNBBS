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
const CITY_SUBURBS: Record<string, string[]> = {
  Sydney: [
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
  ],
  Melbourne: [
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
  ],
  Brisbane: ['Sunnybank', 'Eight Mile Plains', 'Brisbane', '布里斯班'],
  Perth: ['Perth', '珀斯'],
  Adelaide: ['Adelaide', '阿德莱德'],
  Canberra: ['Canberra', '堪培拉'],
  'Gold Coast': ['Gold Coast', '黄金海岸'],
  Townsville: ['Townsville'],
};

const SUBURB_CITY = new Map(
  Object.entries(CITY_SUBURBS).flatMap(([city, subs]) => subs.map((s) => [s, city] as const)),
);

const LOCATIONS = Object.values(CITY_SUBURBS).flat();

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

/** Canonical English city name for a suburb/city mention, e.g. "Eastwood" → "Sydney". */
export function extractCity(text: string): string | null {
  const m = LOCATION_RE.exec(text);
  if (!m) return null;
  const raw = m[1][0].toUpperCase() + m[1].slice(1);
  return SUBURB_CITY.get(m[1]) ?? SUBURB_CITY.get(raw) ?? null;
}

/** Canonical English location names stored for a city, e.g. "Sydney" → ["Sydney","Eastwood",...]. */
export function cityLocations(cityNameEn: string): string[] {
  const subs = CITY_SUBURBS[cityNameEn] ?? [];
  return [...new Set(subs.map((s) => CANONICAL[s] ?? s).filter((s) => /^[A-Za-z]/.test(s)))];
}

/** Local date/time parts in a timezone. */
function tzParts(now: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((v) => [v.type, v.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, dow: new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay() };
}

/** Convert a local wall-clock time to UTC (iterative DST-safe). */
function localToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += target - local;
  }
  return new Date(guess);
}

const WEEKDAY: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
};

const TIME_RES: [RegExp, (m: RegExpExecArray) => { h: number; min: number } | null][] = [
  // 14:00 / 2:30pm
  [
    /(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?/,
    (m) => {
      let h = +m[1];
      if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
      if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
      return h < 24 ? { h, min: +m[2] } : null;
    },
  ],
  // 下午3点 / 上午10点半 / 晚上7点
  [
    /(上午|早上|中午|下午|晚上|晚)\s*(\d{1,2})\s*[点时](半)?/,
    (m) => {
      let h = +m[2];
      if (['下午', '晚上', '晚'].includes(m[1]) && h < 12) h += 12;
      if (m[1] === '中午' && h < 6) h += 12;
      return h < 24 ? { h, min: m[3] ? 30 : 0 } : null;
    },
  ],
  // 3点 / 10点半
  [/(\d{1,2})\s*[点时](半)?/, (m) => (+m[1] < 24 ? { h: +m[1], min: m[2] ? 30 : 0 } : null)],
];

/**
 * Parse a Chinese event date/time from post text. Returns start/end in UTC,
 * or null when no date expression is found. Day-level granularity defaults
 * to 10:00 local; end defaults to start + 3h.
 */
export function extractEventDate(
  text: string,
  now = new Date(),
  timeZone = 'Australia/Sydney',
): { start: Date; end: Date } | null {
  let y: number, m: number, d: number;
  const t = tzParts(now, timeZone);

  const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(text) ?? /(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/.exec(text);
  const wd = /(本周|这周|下周|下个|下|这个)?\s*(?:周|星期|礼拜)([一二三四五六日天])/.exec(text);
  const wk = /本周末|这周末|周末/.exec(text);

  if (md) {
    m = +md[1];
    d = +md[2];
    y = t.y;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    // If the date already passed this year, assume next year.
    if (localToUtc(y, m, d, 23, 59, timeZone) < now) y += 1;
  } else if (wd) {
    const want = WEEKDAY[wd[2]];
    const offset = wd[1]?.startsWith('下') ? 7 : 0;
    let delta = (want - t.dow + 7) % 7;
    if (delta === 0 && !offset) delta = 0; // same weekday → today
    delta += offset;
    const target = new Date(Date.UTC(t.y, t.m - 1, t.d + delta));
    y = target.getUTCFullYear();
    m = target.getUTCMonth() + 1;
    d = target.getUTCDate();
  } else if (wk) {
    const delta = (6 - t.dow + 7) % 7; // Saturday
    const target = new Date(Date.UTC(t.y, t.m - 1, t.d + delta));
    y = target.getUTCFullYear();
    m = target.getUTCMonth() + 1;
    d = target.getUTCDate();
  } else {
    return null;
  }

  let h = 10;
  let min = 0;
  for (const [re, f] of TIME_RES) {
    const tm = re.exec(text);
    const v = tm && f(tm);
    if (v) {
      h = v.h;
      min = v.min;
      break;
    }
  }
  const start = localToUtc(y, m, d, h, min, timeZone);
  return { start, end: new Date(start.getTime() + 3 * 3600_000) };
}
