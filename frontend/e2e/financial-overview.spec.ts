import { expect, test } from '@playwright/test';
import { amountInTenThousands, ratioPercent, availableOverviewPeriods, waterfallData } from '../src/financialOverviewData';

test('missing financial values stay unknown rather than zero', () => {
  expect(amountInTenThousands(null)).toBe('—');
  expect(amountInTenThousands(0)).toBe('0.0');
  expect(amountInTenThousands(-12340000)).toBe('-1,234.0');
  expect(ratioPercent(null)).toBe('—');
  expect(ratioPercent(0.95)).toBe('95.0%');
});

test('aggregate periods require coverage for every entity', () => {
  const catalog = { periods: ['2026-08', '2026-07'], entities: ['甲', '乙'], available_scopes: [{ period: '2026-07', entity: '甲' }, { period: '2026-07', entity: '乙' }, { period: '2026-08', entity: '甲' }], dataset_name: '', currency: 'CNY', as_of: '' };
  expect(availableOverviewPeriods(catalog, 'all')).toEqual(['2026-07']);
  expect(availableOverviewPeriods(catalog, '甲')).toEqual(['2026-07', '2026-08']);
});

test('waterfall contributions preserve negative and zero-crossing balances', () => {
  expect(waterfallData([{ label: '预算', kind: 'total', value: 100000 }, { label: '不利', kind: 'delta', value: -150000 }, { label: '有利', kind: 'delta', value: 20000 }, { label: '实际', kind: 'total', value: -30000 }]).map(row => row.span)).toEqual([[0, 10], [-5, 10], [-5, -3], [-3, 0]]);
});
