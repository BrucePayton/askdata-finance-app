// Platform credentials deliberately stay in memory, never in URLs or storage.
import { consumeRecoverable } from "./shared/analysis-room/transport";
export { readEventStream } from "./shared/analysis-room/transport";
let token = "";
export const platformToken = () => token;
export function setPlatformToken(value: string) {
  const changed = token !== value;
  token = value;
  if (changed || !value) {
    try { Object.keys(sessionStorage).filter(key => key.startsWith("finance-stream:")).forEach(key => sessionStorage.removeItem(key)); } catch { /* Storage may be disabled. */ }
  }
  window.dispatchEvent(new Event("finance-platform-auth"));
}
export async function platformRequest<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const multipart = body instanceof FormData;
  const requestToken = token;
  const response = await fetch(applicationCenterPath(path), {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { ...(multipart ? {} : { "Content-Type": "application/json" }), ...(requestToken ? { Authorization: requestToken } : {}) },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(multipart ? 180000 : 60000),
  });
  if (response.status === 401 && requestToken && token === requestToken) setPlatformToken("");
  const data = await response.json().catch(() => { throw new Error(`平台返回非 JSON 响应（${response.status}）`); });
  if (!response.ok || (data.code !== undefined && data.code !== 0)) {
    throw new Error(typeof data.detail === "string" ? data.detail : data.message || `平台请求失败（${response.status}）`);
  }
  return ("payload" in data ? data.payload : data) as T;
}

// One versioned integration entry shared by professional applications. No domain-
// specific backend copies: identity, workspace and artifact IDs remain canonical.
export function applicationCenterPath(path: string): string {
  return /^\/api\/(user|wp|datasource|kb|askdata)\//.test(path)
    ? path.replace(/^\/api\//, "/api/application-center/v1/") : path;
}

export type StreamEvent = { event: string; data: Record<string, unknown> };
export async function streamAnalysis(body: Record<string, unknown>, signal: AbortSignal, receive: (event: StreamEvent) => void) {
  const response = await fetch(applicationCenterPath("/api/askdata/chat/stream"), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ ...body, stream_protocol: "analysis.v1" }), signal,
  });
  const runId = response.headers.get("X-Analysis-Run-ID");
  if (runId && /^[a-f0-9]{32}$/.test(runId)) {
    try { sessionStorage.setItem(`finance-stream:${body.workspace_id}`, JSON.stringify({ runId, threadId: body.thread_id })); } catch { /* Browsers may disable storage. */ }
  }
  await consumeRecoverable(response, runId, signal, receive, replayResponse);
}

export function savedAnalysis(workspace: string): { runId: string; threadId: string } | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(`finance-stream:${workspace}`) || "null");
    if (value && /^[a-f0-9]{32}$/.test(value.runId) && typeof value.threadId === "string") return value;
  } catch { /* Invalid or unavailable browser storage. */ }
}

function replayResponse(runId: string, after: number, signal?: AbortSignal) {
  return fetch(applicationCenterPath(`/api/askdata/chat/runs/${runId}/events?after=${after}`), {
    headers: { Authorization: token }, signal,
  });
}

export async function replayAnalysis(runId: string, signal: AbortSignal, receive: (event: StreamEvent) => void) {
  await consumeRecoverable(await replayResponse(runId, 0, signal), runId, signal, receive, replayResponse);
}

export type AnalysisRun = {
  run_id: string; thread_id: string; status: string;
  context?: { query?: string; analysis_scope?: Record<string, unknown>; application_context?: Record<string, unknown>; session_outcome_goals?: string[] };
};
function runPath(runId: string) {
  if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error('分析执行标识无效');
  return `/api/askdata/chat/runs/${runId}`;
}
export function getAnalysisRun(runId: string) { return platformRequest<AnalysisRun>(runPath(runId)); }
export function cancelAnalysisRun(runId: string) { return platformRequest<AnalysisRun>(`${runPath(runId)}/cancel`, {}); }
