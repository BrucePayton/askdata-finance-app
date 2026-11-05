export type SequencedEvent = { event: string; data: Record<string, unknown> };

/** One cursor per execution; legacy unnumbered events keep their original order. */
export class StreamSequence {
  runId = "";
  last = 0;
  private pending = new Map<number, SequencedEvent>();

  accept(event: SequencedEvent, emit: (event: SequencedEvent) => void) {
    const meta = event.data._stream as { run_id?: string; seq?: number } | undefined;
    if (!meta) { emit(event); return; }
    if (!meta.run_id || !Number.isSafeInteger(meta.seq) || (meta.seq ?? 0) < 1) throw new Error("分析事件游标无效");
    if (this.runId && this.runId !== meta.run_id) throw new Error("分析执行标识不一致");
    this.runId = meta.run_id;
    const seq = meta.seq!;
    if (seq <= this.last) return;
    if (event.event === "stream_snapshot") {
      this.pending.clear(); this.last = seq; emit(event); return;
    }
    this.pending.set(seq, event);
    if (this.pending.size > 512) throw new Error("分析事件缺失，请恢复结果接收");
    while (this.pending.has(this.last + 1)) {
      const next = this.pending.get(this.last + 1)!;
      emit(next);
      this.pending.delete(++this.last);
    }
  }
}
