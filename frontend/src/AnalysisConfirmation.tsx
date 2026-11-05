import { isRecord } from './shared/analysis-room/reducer';

export interface ConfirmationRequest { type: 'analysis_confirmation'; revision: string; title: string; summary: string }
export function analysisConfirmation(value: unknown, depth = 0): ConfirmationRequest | undefined {
  if (depth > 5) return;
  if (Array.isArray(value)) {
    for (const item of value) { const found = analysisConfirmation(item, depth + 1); if (found) return found; }
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === 'analysis_confirmation' && typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision)) {
    return { type: 'analysis_confirmation', revision: value.revision,
      title: typeof value.title === 'string' ? value.title : '扩展分析需要确认',
      summary: typeof value.summary === 'string' ? value.summary : '请核对本次扩展范围与成本；拒绝不会继续执行。' };
  }
  for (const key of ['value', 'data', 'payload', 'interrupt', 'interrupts']) {
    const found = analysisConfirmation(value[key], depth + 1); if (found) return found;
  }
}
export function AnalysisConfirmation({ value, disabled, onDecision }: {
  value: ConfirmationRequest; disabled: boolean; onDecision: (decision: 'approve' | 'reject') => void;
}) {
  return <section className="platform-interrupt" aria-label="扩展分析执行确认"><h4>{value.title}</h4><p>{value.summary}</p>
    <p>只确认当前版本及口径；口径变化后原确认失效。本次确认不代表发布报告。</p>
    <div className="platform-toolbar"><button className="primary" disabled={disabled} onClick={() => onDecision('approve')}>同意本次扩展执行</button>
      <button className="secondary" disabled={disabled} onClick={() => onDecision('reject')}>拒绝扩展并保留已有结果</button></div>
  </section>;
}
