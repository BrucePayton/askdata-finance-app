import { useEffect, useState } from 'react';

export interface KnowledgePolicy {
  id: number; title: string; version: number; workspace_id: number;
  metadata: { policy_key: string; category: string; entities?: string[]; effective_from?: string; effective_until?: string;
    review_status: string; revision: number; is_test_policy?: boolean; sources?: string[]; license?: string;
    document_snapshot?: string; review_history?: { action: string; note: string; at: string }[] };
}
export type PolicyRequest = <T>(path: string, body?: unknown) => Promise<T>;
const statusLabel: Record<string, string> = { draft: '草稿', pending_review: '待复核', approved: '已批准', revoked: '已废止' };

/** No auth storage or routing dependency: both hosts use the same policy IDs/API. */
export function KnowledgePolicies({ workspace, request, domainCode }: { workspace: string; request: PolicyRequest; domainCode?: string }) {
  const [items, setItems] = useState<KnowledgePolicy[]>([]), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [snapshot, setSnapshot] = useState<KnowledgePolicy>();
  const [form, setForm] = useState({ dataset_id: '', document_id: '', document_name: '', policy_key: '', title: '', category: '指标与核算口径', entities: '', effective_from: '', effective_until: '', sources: '', license: '', is_test_policy: true });
  useEffect(() => {
    let active = true; setItems([]); setSnapshot(undefined); setError('');
    if (workspace) request<{ items: KnowledgePolicy[] }>(`/api/askdata/knowledge/policies?workspace_id=${encodeURIComponent(workspace)}`)
      .then(result => { if (active) setItems(result.items); }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [workspace, request, revision]);
  const operate = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '知识治理请求失败'); }
    finally { setBusy(false); }
  };
  const review = (item: KnowledgePolicy, action: string) => operate(async () => {
    await request(`/api/askdata/knowledge/policies/${item.id}/review`, { workspace_id: Number(workspace), action, expected_revision: item.metadata.revision, note: notes[item.id]?.trim() });
    setRevision(value => value + 1);
  });
  return <section aria-label="知识制度版本治理"><h3>知识制度版本与财务复核</h3>
    <p>索引完成不等于制度获批。下列版本、主体、有效期与复核状态均由底座维护；历史正文不因废止而删除。</p>
    <button disabled={busy || !workspace} onClick={() => setRevision(value => value + 1)}>刷新制度版本</button>
    {error && <p role="alert">{error}</p>}
    {!items.length && <p>当前工作空间尚无已登记知识版本；不会将未登记文件自动视为已批准制度。</p>}
    {items.map(item => <article className="panel" key={item.id}><h4>{item.title} · v{item.version}</h4>
      <p>状态：{statusLabel[item.metadata.review_status] || item.metadata.review_status}{item.metadata.is_test_policy ? ' · 仅测试制度' : ''}</p>
      <p>{item.metadata.category} · 主体：{item.metadata.entities?.join('、') || '未限定主体'} · {item.metadata.effective_from || '未限定起始日'} 至 {item.metadata.effective_until || '未限定终止日'}</p>
      <p>来源：{item.metadata.sources?.join('；') || '未提供'} · 授权：{item.metadata.license || '未提供'}</p>
      <button disabled={busy} onClick={() => void operate(async () => setSnapshot(await request<KnowledgePolicy>(`/api/askdata/knowledge/policies/${item.id}/snapshot?workspace_id=${encodeURIComponent(workspace)}`)))}>查看版本 {item.version} 冻结正文</button>
      <details><summary>制度复核操作（管理员）</summary>
        <label>版本 {item.id} 复核理由<textarea value={notes[item.id] || ''} onChange={e => setNotes(current => ({ ...current, [item.id]: e.target.value }))} /></label>
        {(item.metadata.review_status === 'draft' ? [['submit', '提交制度复核']] : item.metadata.review_status === 'pending_review' ? [['approve', '批准制度版本'], ['return', '退回制度版本']] : item.metadata.review_status === 'approved' ? [['revoke', '废止制度版本']] : []).map(([action, label]) =>
          <button key={action} disabled={busy || !notes[item.id]?.trim()} onClick={() => void review(item, action)}>{label}</button>)}
        {item.metadata.review_history?.map((entry, index) => <p key={`${entry.at}:${index}`}>{entry.at} · {entry.action} · {entry.note}</p>)}
      </details>
    </article>)}
    {snapshot && <section aria-label="冻结知识正文"><h4>{snapshot.title} · v{snapshot.version}</h4><pre style={{ whiteSpace: 'pre-wrap' }}>{snapshot.metadata.document_snapshot}</pre><button onClick={() => setSnapshot(undefined)}>关闭知识正文</button></section>}
    <details><summary>登记财务知识版本（管理员）</summary><p>仅绑定已完成索引的真实文档。底座核验知识库挂载与文档 ID 并生成正文快照，浏览器不能伪造获批正文。</p>
      <form onSubmit={event => { event.preventDefault(); void operate(async () => {
        await request('/api/askdata/knowledge/policies', { ...form, workspace_id: Number(workspace), entities: form.entities.split(/[，,]/).map(value => value.trim()).filter(Boolean), sources: form.sources.split('\n').map(value => value.trim()).filter(Boolean), effective_from: form.effective_from || null, effective_until: form.effective_until || null, domain_codes: domainCode ? [domainCode] : [] });
        setRevision(value => value + 1);
      }); }}>
        {([['title', '制度名称'], ['policy_key', '口径唯一标识'], ['category', '财务专题'], ['entities', '适用主体（逗号分隔）'], ['dataset_id', '底座数据集 ID'], ['document_id', '底座文档 ID'], ['document_name', '真实文档名称'], ['sources', '来源说明或链接（每行一项）'], ['license', '授权与引用边界']] as const).map(([key, label]) => <label key={key}>{label}<input required={key !== 'entities'} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        <label>生效日期<input type="date" value={form.effective_from} onChange={e => setForm(current => ({ ...current, effective_from: e.target.value }))} /></label>
        <label>终止日期<input type="date" value={form.effective_until} onChange={e => setForm(current => ({ ...current, effective_until: e.target.value }))} /></label>
        <label><input type="checkbox" checked={form.is_test_policy} onChange={e => setForm(current => ({ ...current, is_test_policy: e.target.checked }))} />仅测试制度，不代表企业正式批准</label>
        <button disabled={busy || !workspace}>登记待复核草稿</button>
      </form>
    </details>
  </section>;
}
