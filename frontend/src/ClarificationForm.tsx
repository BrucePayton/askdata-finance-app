import { useState } from "react";

type Question = { id: string; prompt: string; selection_mode?: string; min_choices?: number; max_choices?: number;
  options: { value: string; label: string; description?: string; allow_custom?: boolean }[] };
export type Clarification = { clarification_id?: string; message?: string; questions: Question[] };

export function ClarificationForm({ value, disabled, onSubmit }: {
  value: Clarification; disabled: boolean; onSubmit: (answers: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, { choices: string[]; text: string }>>({});
  const valid = value.questions.every(q => {
    const d = draft[q.id];
    return d && d.choices.length >= (q.min_choices ?? 1) && d.choices.length <= (q.max_choices ?? (q.selection_mode === "multiple" ? q.options.length : 1))
      && (!q.options.some(o => o.allow_custom && d.choices.includes(o.value)) || !!d.text.trim());
  });
  return <form onSubmit={e => {
    e.preventDefault(); if (!valid || disabled) return;
    onSubmit({ clarification_id: value.clarification_id, answers: value.questions.map(q => ({
      question_id: q.id, ...(q.selection_mode === "multiple" ? { choices: draft[q.id].choices } : { choice: draft[q.id].choices[0] }),
      ...(draft[q.id].text.trim() ? { custom_text: draft[q.id].text.trim() } : {}),
    })) });
  }}>
    <p>{value.message}</p>
    {value.questions.map(q => <fieldset key={q.id} disabled={disabled}><legend>{q.prompt}</legend>
      {q.options.map(o => <label key={o.value}><input type={q.selection_mode === "multiple" ? "checkbox" : "radio"}
        name={q.id} checked={draft[q.id]?.choices.includes(o.value) || false} onChange={e => setDraft(current => {
          const previous = current[q.id] || { choices: [], text: "" };
          const choices = q.selection_mode === "multiple" ? (e.target.checked ? [...previous.choices, o.value] : previous.choices.filter(c => c !== o.value)) : [o.value];
          return { ...current, [q.id]: { ...previous, choices } };
        })} />{o.label}{o.description && <small> — {o.description}</small>}</label>)}
      <label>补充说明<textarea value={draft[q.id]?.text || ""} onChange={e => setDraft(current => ({ ...current,
        [q.id]: { choices: current[q.id]?.choices || [], text: e.target.value } }))} /></label>
    </fieldset>)}
    <button className="primary" disabled={disabled || !valid}>提交口径选择并继续</button>
  </form>;
}
