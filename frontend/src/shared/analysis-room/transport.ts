import { StreamSequence } from "./sequence";
import type { AnalysisEvent as StreamEvent } from "./reducer";
export async function readEventStream(response: Response, receive: (event: StreamEvent) => void) {
  if (!response.ok) throw new Error(`智能分析请求失败（${response.status}）：${(await response.text()).slice(0, 300)}`);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("平台未返回事件流，请检查登录与服务状态");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("平台未返回响应流");
  const decoder = new TextDecoder();
  let buffer = "";
  function emit(block: string) {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
    const text = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!text || text === "[DONE]") return;
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch { throw new Error("平台事件数据格式错误"); }
    receive({ event, data });
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        emit(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (done) { if (buffer.trim()) emit(buffer); break; }
    }
  } finally { reader.releaseLock(); }
}
export async function consumeRecoverable(initial: Response, runId: string | null, signal: AbortSignal | undefined, receive: (event: StreamEvent) => void, replayResponse: (runId: string, after: number, signal?: AbortSignal) => Promise<Response>) {
  const sequence = new StreamSequence();
  let response = initial, terminal = false;
  const accept = (event: StreamEvent) => sequence.accept(event, next => {
    if (next.event === "stream_terminal") terminal = true;
    if (next.event === "stream_snapshot") {
      const latest = next.data.latest as Record<string, unknown> | undefined;
      if (latest?.stream_terminal) terminal = true;
    }
    receive(next);
    if (next.event === "stream_snapshot") {
      const latest = next.data.latest as { stream_terminal?: Record<string, unknown> } | undefined;
      if (latest?.stream_terminal) receive({ event: "stream_terminal", data: latest.stream_terminal });
    }
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await readEventStream(response, accept);
      if (!runId || terminal) return;
    } catch (error) {
      if (!runId || signal?.aborted || terminal || !response.ok || attempt === 2) throw error;
    }
    if (attempt === 2) throw new Error("结果连接已中断，可恢复接收；不会重新执行查询");
    response = await replayResponse(runId!, sequence.last, signal);
  }
}
