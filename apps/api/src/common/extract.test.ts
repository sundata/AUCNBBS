import { describe, expect, it } from 'vitest';
import { extractCity, extractEventDate, extractLocation, extractPrice } from './extract';

describe('extractPrice', () => {
  it('parses weekly rent patterns', () => {
    expect(extractPrice('Eastwood 两房一厅 $650/week 包bill')).toEqual({
      cents: 65000,
      period: 'week',
    });
    expect(extractPrice('Burwood 单间出租 周租$380')).toEqual({ cents: 38000, period: 'week' });
    expect(extractPrice('Hurstville master room $450pw')).toEqual({
      cents: 45000,
      period: 'week',
    });
  });

  it('parses hourly pay patterns', () => {
    expect(extractPrice('餐厅招全职 时薪$28 现金工')).toEqual({ cents: 2800, period: 'hour' });
    expect(extractPrice('warehouse storeman $32/h')).toEqual({ cents: 3200, period: 'hour' });
    expect(extractPrice('招清洁 35刀/小时')).toEqual({ cents: 3500, period: 'hour' });
  });

  it('falls back to one-off prices for market posts', () => {
    expect(extractPrice('出九成新冰箱 $200 自取')).toEqual({ cents: 20000, period: 'once' });
  });

  it('rejects implausible amounts and plain text', () => {
    expect(extractPrice('2026年新学期招生啦')).toBeNull();
    expect(extractPrice('周租$5 是不可能的')).toBeNull();
    expect(extractPrice('有没有西南区的朋友')).toBeNull();
  });
});

describe('extractLocation', () => {
  it('finds English suburb names', () => {
    expect(extractLocation('Eastwood 近火车站三房出租')).toBe('Eastwood');
  });

  it('canonicalises Chinese city names', () => {
    expect(extractLocation('悉尼ct招合租')).toBe('Sydney');
    expect(extractLocation('请问墨尔本有华人群吗')).toBe('Melbourne');
  });

  it('prefers longer suburb names', () => {
    expect(extractLocation('Glen Waverley 学区房租')).toBe('Glen Waverley');
  });

  it('returns null when nothing matches', () => {
    expect(extractLocation('随便聊聊天气')).toBeNull();
  });
});

describe('extractCity', () => {
  it('maps suburbs to their city', () => {
    expect(extractCity('Eastwood 周六有人打球吗')).toBe('Sydney');
    expect(extractCity('Box Hill 读书会')).toBe('Melbourne');
    expect(extractCity('堪培拉周末爬山')).toBe('Canberra');
    expect(extractCity('随便聊聊')).toBeNull();
  });
});

describe('extractEventDate', () => {
  const now = new Date('2026-09-20T00:00:00Z'); // Sunday in Sydney

  it('parses explicit month/day dates', () => {
    const r = extractEventDate('10月3日 墨尔本中秋聚餐', now);
    expect(r).not.toBeNull();
    expect(r!.start.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('rolls explicit dates into next year when past', () => {
    const r = extractEventDate('3月29日 读书会', now);
    expect(r!.start.getUTCFullYear()).toBe(2027);
  });

  it('parses weekday expressions', () => {
    const r = extractEventDate('本周六下午2点 Eastwood 羽毛球', now);
    expect(r).not.toBeNull();
    // Saturday 2026-09-26 14:00 Sydney = 04:00 UTC
    expect(r!.start.toISOString()).toBe('2026-09-26T04:00:00.000Z');
    expect(r!.end.getTime() - r!.start.getTime()).toBe(3 * 3600_000);
  });

  it('parses next-week expressions', () => {
    const r = extractEventDate('下周三晚上7点 聚餐', now);
    expect(r!.start.toISOString()).toBe('2026-09-30T09:00:00.000Z');
  });

  it('parses 周末 as Saturday', () => {
    const r = extractEventDate('周末去 Sunnybank 赶集', now);
    expect(r!.start.getUTCDay?.() ?? new Date(r!.start).getUTCDay()).toBe(6);
  });

  it('returns null without any date expression', () => {
    expect(extractEventDate('Eastwood 两房出租 $600一周', now)).toBeNull();
  });
});
