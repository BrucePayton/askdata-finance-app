import type { Analysis } from './types';
import type { ScopeCatalog } from './FinancialScope';

export const amountInTenThousands = (value: number | null | undefined) => value == null ? '—' : (value / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const ratioPercent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;

export function availableOverviewPeriods(catalog: ScopeCatalog, entity: string) {
  const entities = entity === 'all' ? catalog.entities : [entity];
  return catalog.periods.filter(period => entities.length > 0 && entities.every(name => catalog.available_scopes.some(row => row.period === period && row.entity === name))).sort();
}

export function waterfallData(bridge: Analysis['bridge']) {
  let running = 0;
  return bridge.map(row => {
    const from = row.kind === 'total' ? 0 : running;
    const to = row.kind === 'total' ? row.value : running + row.value;
    running = to;
    return { ...row, span: [Math.min(from, to) / 10000, Math.max(from, to) / 10000],
      fill: row.kind === 'total' ? '#1d5265' : row.value >= 0 ? '#278477' : '#c87a4e' };
  });
}
