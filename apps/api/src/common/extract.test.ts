import { describe, expect, it } from 'vitest';
import { extractLocation, extractPrice } from './extract';

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
