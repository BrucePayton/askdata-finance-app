import { test, expect } from '@playwright/test';
import { StreamSequence, type SequencedEvent } from '../src/streamSequence';
import { streamAnalysis } from '../src/platform';

function event(seq: number, type = 'message_chunk'): SequencedEvent {
  return { event: type, data: { content: String(seq), _stream: { run_id: 'one', seq } } };
}

test('duplicates and out-of-order deliveries do not repeat content', () => {
  const sequence = new StreamSequence();
  const values: string[] = [];
  const emit = (item: SequencedEvent) => values.push(String(item.data.content));
  for (const seq of [2, 1, 2, 4, 3, 1]) sequence.accept(event(seq), emit);
  expect(values).toEqual(['1', '2', '3', '4']);
  expect(sequence.last).toBe(4);
});

test('a snapshot replaces a missing prefix and keeps legacy event compatibility', () => {
  const sequence = new StreamSequence();
  const values: string[] = [];
  const emit = (item: SequencedEvent) => values.push(item.event);
  sequence.accept(event(4), emit);
  sequence.accept(event(8, 'stream_snapshot'), emit);
  sequence.accept(event(7), emit);
  sequence.accept(event(9), emit);
  sequence.accept({ event: 'interrupt', data: {} }, emit);
  expect(values).toEqual(['stream_snapshot', 'message_chunk', 'interrupt']);
});

test('unexpected EOF reconnects with GET and never repeats the graph POST', async () => {
  const originalFetch = globalThis.fetch;
  const runId = 'a'.repeat(32);
  const calls: { url: string; method: string }[] = [];
  const frame = (seq: number, event: string, data: Record<string, unknown>) =>
    `event: ${event}\ndata: ${JSON.stringify({ ...data, _stream: { run_id: runId, seq, version: 'analysis.v1' } })}\n\n`;
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), method: options?.method || 'GET' });
    return new Response(calls.length === 1
      ? frame(1, 'message_chunk', { content: '收入' })
      : frame(1, 'message_chunk', { content: '收入' }) + frame(2, 'message_chunk', { content: '增长' }) + frame(3, 'stream_terminal', { status: 'completed' }),
    { headers: { 'Content-Type': 'text/event-stream', 'X-Analysis-Run-ID': runId } });
  };
  try {
    let answer = '';
    await streamAnalysis({ workspace_id: 8, thread_id: 'test' }, new AbortController().signal, item => {
      if (item.event === 'message_chunk') answer += String(item.data.content);
    });
    expect(answer).toBe('收入增长');
    expect(calls.map(call => call.method)).toEqual(['POST', 'GET']);
    expect(calls[1].url).toContain(`/runs/${runId}/events?after=1`);
  } finally { globalThis.fetch = originalFetch; }
});
