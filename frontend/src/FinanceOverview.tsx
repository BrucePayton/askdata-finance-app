import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell, Legend, ReferenceLine, ComposedChart, Line, PieChart, Pie } from 'recharts';
import { Activity, ArrowUpRight, CalendarDays, TrendingUp, Wallet } from 'lucide-react';
import { platformRequest } from './platform';
import type { Analysis } from './types';
import type { ScopeCatalog } from './FinancialScope';
import { amountInTenThousands as amount, ratioPercent as percent, availableOverviewPeriods, waterfallData } from './financialOverviewData';

export default function FinanceOverview({ workspace, revision, catalog, onAsk }: {
  workspace: string; revision: string; catalog: ScopeCatalog; onAsk: (question: string) => void;
}) {
  const [entity, setEntity] = useState(() => availableOverviewPeriods(catalog, 'all').length ? 'all' : catalog.entities[0] || '');
  const [period, setPeriod] = useState(() => availableOverviewPeriods(catalog, entity).at(-1) || '');
  const [snapshot, setSnapshot] = useState<{ key: string; data: Analysis }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [retry, setRetry] = useState(0);
  const selection = `${workspace}:${revision}:${entity}:${period}:${retry}`;
  const result = snapshot?.key === selection ? snapshot.data : undefined;
  const error = failure?.key === selection ? failure.message : '';
  const periods = availableOverviewPeriods(catalog, entity);
  useEffect(() => {
    let current = true;
    if (!period || !entity) return;
    platformRequest<Analysis>(`/api/application-center/v1/workspaces/${workspace}/applications/finance/apps/profit/calculation`, {
      period, entity, context_revision: revision,
    }).then(data => {
      if (current) setSnapshot({ key: selection, data });
    }).catch(reason => { if (current) setFailure({ key: selection, message: reason.message }); });
    return () => { current = false; };
  }, [workspace, revision, entity, period, retry, selection]);
  const cards = result ? [
    { label: '营业收入', value: result.metrics.revenue, icon: TrendingUp, note: `预算达成 ${percent(result.metrics.revenue_attainment)}` },
    { label: '管理口径经营利润', value: result.metrics.operating_profit, icon: Activity, note: `预算差异 ${amount(result.metrics.profit_variance)} 万元` },
    { label: '经营活动现金净流量', value: result.metrics.operating_cash, icon: Wallet, note: `期末现金 ${amount(result.metrics.closing_cash)} 万元` },
    { label: '逾期应收余额', value: result.metrics.overdue, icon: CalendarDays, note: result.metrics.receivables == null ? '所选期间无可用应收快照' : `应收总额 ${amount(result.metrics.receivables)} 万元` },
  ] : [];
  const entityPerformance = (result?.entities || []).map(row => ({ ...row, revenueWan: row.revenue / 10000, profitWan: row.profit / 10000, cashWan: row.cash / 10000 }));
  const customerExposure = result ? Object.entries((result.invoices || []).reduce<Record<string, number>>((total, row) => {
    const customer = row.customer?.trim() || '未识别客户';
    const outstanding = Number(row.outstanding);
    if (Number.isFinite(outstanding)) total[customer] = (total[customer] || 0) + outstanding;
    return total;
  }, {})).sort((left, right) => right[1] - left[1]).slice(0, 6).map(([customer, value]) => ({ customer, value })) : [];
  const exposureTotal = customerExposure.reduce((total, row) => total + row.value, 0);
  const qualityMetrics = result ? [
    ['销售毛利率', result.metrics.gross_margin, '反映收入扣除营业成本后的盈利空间'],
    ['经营现金转换率', result.metrics.cash_conversion, '观察当期净利润转化为经营现金的程度'],
    ['净资产收益率 ROE', result.metrics.roe, '连接盈利、周转与资本结构的综合结果'],
  ].filter((row): row is [string, number, string] => typeof row[1] === 'number') : [];
  const exposureColors = ['#176f65', '#438f86', '#70aa9d', '#a0c4b6', '#c8d8ca', '#d1b37b'];
  return <section className="finance-overview" aria-label="衡策财务经营总览">
    <div className="v2-section-heading"><div><h2>财务经营总览</h2><p className="v2-note">让每一个数字，成为经营的洞察。</p></div>
      <div className="overview-filters"><label>核算主体<select aria-label="核算主体" value={entity} onChange={event => {
        const next = event.target.value; const choices = availableOverviewPeriods(catalog, next);
        setEntity(next); if (!choices.includes(period)) setPeriod(choices.at(-1) || '');
      }}>{catalog.entities.map(name => <option key={name}>{name}</option>)}{availableOverviewPeriods(catalog, 'all').length > 0 && <option value="all">全部主体简单汇总</option>}</select></label>
        <label>会计期间<select aria-label="会计期间" value={period} onChange={event => setPeriod(event.target.value)}>{periods.map(value => <option key={value}>{value}</option>)}</select></label>
        <button className="secondary" onClick={() => setRetry(value => value + 1)}>刷新指标</button>
      </div>
    </div>
    {entity === 'all' && <p className="v2-note">多主体仅为简单汇总，未做内部交易抵销，不能视为合并报表。</p>}
    {error ? <p className="v2-error" role="alert">{error}；当前指标未显示旧值，请刷新空间或指标后重试。</p>
      : !period ? <p>当前主体没有完整可用期间。</p> : !result ? <p role="status">正在计算当前空间的真实财务指标…</p> : <>
      <div className="overview-kpis">{cards.map(card => <article className="overview-kpi" key={card.label}><div>{card.label}<card.icon size={18} /></div><strong>{amount(card.value)}<small>万元</small></strong><p>{card.note}</p></article>)}</div>
      <div className="overview-charts"><article className="v2-card"><h3>收入趋势与预算执行</h3><p>截至所选期间近 8 个有数据月份 · 万元；月份间隔或口径变化需单独核对。</p>
        <div className="overview-chart" role="img" aria-label="实际收入与预算收入趋势图"><ResponsiveContainer width="100%" height="100%"><AreaChart data={result.trend.slice(-8)} margin={{ top: 12, right: 10, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 10 }} /><YAxis tickFormatter={value => amount(Number(value))} width={62} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value: number) => `${amount(value)} 万元`} /><Legend />
          <Area name="实际收入" type="linear" dataKey="revenue" stroke="#207c71" fill="#d5eae3" isAnimationActive={false} />
          <Area name="预算收入" type="linear" dataKey="budget" stroke="#83969c" fill="transparent" strokeDasharray="5 4" isAnimationActive={false} />
        </AreaChart></ResponsiveContainer></div>
        <details><summary>查看趋势数据</summary><table><thead><tr><th>期间</th><th>实际收入（万元）</th><th>预算收入（万元）</th></tr></thead><tbody>{result.trend.slice(-8).map(row => <tr key={row.period}><td>{row.period}</td><td>{amount(row.revenue)}</td><td>{amount(row.budget)}</td></tr>)}</tbody></table></details>
      </article><article className="v2-card"><h3>应收账龄结构</h3><p>按到期日与数据截止日计算，不将逾期直接认定为减值。</p>
        {result.metrics.receivables == null ? <div className="overview-empty">所选月份没有应收快照</div> : <div className="overview-chart" role="img" aria-label="应收账龄余额柱状图"><ResponsiveContainer width="100%" height="100%"><BarChart data={result.aging} margin={{ top: 12, right: 10, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis width={62} tickFormatter={value => amount(Number(value))} tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number) => `${amount(value)} 万元`} />
          <Bar name="应收余额" dataKey="value" fill="#477f82" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>}
        <button className="v2-open" onClick={() => onAsk(`${period}，${entity === 'all' ? '全部主体简单汇总' : entity}，分析应收账龄及催收优先级，明确数据限制。`)}>在分析室深入核对应收 <ArrowUpRight size={16} /></button>
      </article><article className="v2-card"><h3>经营利润预算差异</h3><p>预算到实际的算术贡献桥，正值有利、负值不利 · 万元；不等于经营根因。</p>
        <div className="overview-chart" role="img" aria-label="经营利润预算差异瀑布图"><ResponsiveContainer width="100%" height="100%"><BarChart data={waterfallData(result.bridge)} margin={{ top: 12, right: 10, bottom: 12, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} /><YAxis width={62} tick={{ fontSize: 11 }} /><ReferenceLine y={0} stroke="#8da3a8" />
          <Tooltip formatter={(_value, _name, item) => [`${amount(item.payload.value)} 万元`, item.payload.label]} />
          <Bar dataKey="span" isAnimationActive={false}>{waterfallData(result.bridge).map(row => <Cell key={row.label} fill={row.fill} />)}</Bar>
        </BarChart></ResponsiveContainer></div>
        <details><summary>查看差异贡献</summary><table><tbody>{result.bridge.map(row => <tr key={row.label}><th>{row.label}</th><td>{amount(row.value)} 万元</td></tr>)}</tbody></table></details>
      </article>{entityPerformance.length > 1 && <article className="v2-card overview-wide"><h3>主体经营规模、利润与现金对比</h3><p>同源比较各主体的收入规模、管理口径经营利润和经营现金；多主体数据未做内部交易抵销。</p>
        <div className="overview-chart" role="img" aria-label="各主体收入利润与经营现金组合图"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={entityPerformance} margin={{ top: 12, right: 18, bottom: 12, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="entity" tick={{ fontSize: 10 }} /><YAxis width={62} tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number) => `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万元`} /><Legend />
          <Bar name="营业收入" dataKey="revenueWan" fill="#b9d8cf" radius={[4, 4, 0, 0]} isAnimationActive={false} /><Line name="经营利润" type="linear" dataKey="profitWan" stroke="#176f65" strokeWidth={3} isAnimationActive={false} /><Line name="经营现金" type="linear" dataKey="cashWan" stroke="#ba7847" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer></div><button className="v2-open" onClick={() => onAsk(`${period}，比较各主体收入、经营利润与经营现金的结构分化，并从销售、采购、费用和回款环节列出待核验驱动因素。`)}>分析主体分化原因 <ArrowUpRight size={16} /></button>
      </article>}{customerExposure.length > 0 && <article className="v2-card"><h3>客户应收风险敞口</h3><p>基于所选期间实际应收明细聚合；集中度用于确定授信和催收复核优先级，不等同于坏账概率。</p>
        <div className="exposure-layout"><div className="overview-chart" role="img" aria-label="客户应收风险敞口环形图"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={customerExposure} dataKey="value" nameKey="customer" innerRadius="48%" outerRadius="78%" paddingAngle={2} isAnimationActive={false}>{customerExposure.map((row, index) => <Cell key={row.customer} fill={exposureColors[index % exposureColors.length]} />)}</Pie><Tooltip formatter={(value: number) => `${amount(Number(value))} 万元`} /></PieChart></ResponsiveContainer></div><ol>{customerExposure.map(row => <li key={row.customer}><span>{row.customer}</span><strong>{amount(row.value)} 万元</strong><small>{exposureTotal ? `${(row.value / exposureTotal * 100).toFixed(1)}%` : '—'}</small></li>)}</ol></div>
      </article>}{qualityMetrics.length > 0 && <article className="v2-card"><h3>盈利质量与资本回报</h3><p>仅展示当前空间能够实际计算的比率，不以缺失字段补零。</p><div className="quality-cards">{qualityMetrics.map(([label, value, explanation]) => <div key={label}><span>{label}</span><strong>{label.includes('转换率') ? `${value.toFixed(2)} 倍` : `${(value * 100).toFixed(2)}%`}</strong><p>{explanation}</p></div>)}</div><button className="v2-open" onClick={() => onAsk(`${period}，${entity === 'all' ? '全部主体简单汇总' : entity}，分析利润含金量、资本回报及其对销售、采购、库存和回款管理的影响。`)}>追问盈利质量 <ArrowUpRight size={16} /></button>
      </article>}<article className="v2-card"><h3>需要关注 <small>{result.issues.length} 项</small></h3><p>明确规则生成的复核提示，不代表审计意见。</p>
        {result.issues.length ? <ul className="overview-issues">{result.issues.map((issue, index) => <li key={index}><strong>{issue.title}</strong><p>{issue.detail}</p></li>)}</ul> : <p>当前规则未触发复核提示；不等于数据已取得审计保证。</p>}
        <button className="v2-open" onClick={() => onAsk(`${period}，${entity === 'all' ? '全部主体简单汇总' : entity}，核对财务异常、预算差异与现金勾稽，列出待验证事项。`)}>进入独立问答分析 <ArrowUpRight size={16} /></button>
      </article></div>
      <details className="v2-legacy"><summary>指标口径与数据依据</summary><p>数据指纹：{result.fingerprint}。金额单位为万元；底层以元计算。</p>{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>
    </>}
  </section>;
}
