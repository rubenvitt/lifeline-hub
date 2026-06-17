# Workflow-Bausteine

Fertige, adaptierbare Skripte für die Fan-out-Phasen. Kopieren, Platzhalter (`<…>`) füllen,
Subtask-Liste/Pfade einsetzen. Alle laufen über das **Workflow-Tool** (Hintergrund, keine
User-Interaktion im Lauf). Ergebnisse landen im Main-Loop → dort Checkpoint/Entscheidung.

Grundregeln (aus der Workflow-Tool-Doku):
- `pipeline()` ist der Default für Mehrstufiges ohne Barriere. `parallel()` nur, wenn du
  **alle** Ergebnisse gemeinsam brauchst (Dedup, Early-Exit, Synthese).
- Mit `schema` gibt `agent()` ein validiertes Objekt zurück — kein Parsen nötig.
- `meta` muss ein reines Literal sein (keine Variablen/Aufrufe).
- Modell weglassen → Agent erbt das Session-Modell (fast immer richtig).

---

## 1. Scope-Fan-out (Phase 1)

Pro Subtask ein Reader-Agent; alle Ergebnisse für die Map zusammenführen (Barriere ist hier
korrekt, weil die Map cross-subtask-Abhängigkeiten braucht).

```js
export const meta = {
  name: 'scope-clickup-task',
  description: 'Scope a ClickUp parent task and its subtasks against the codebase',
  phases: [{ title: 'Scope' }],
}
const SUBTASKS = args.subtasks  // [{custom_id, name, description}]
const SCOPE = {
  type: 'object',
  properties: {
    custom_id: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    depends_on: { type: 'array', items: { type: 'string' } }, // custom_ids
    complexity: { enum: ['trivial', 'klar', 'unklar', 'multi-step'] },
    open_questions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['custom_id', 'files', 'depends_on', 'complexity', 'open_questions', 'summary'],
}
const map = await parallel(SUBTASKS.map(st => () =>
  agent(
    `Scope subtask ${st.custom_id} "${st.name}" against this codebase.\n` +
    `Beschreibung:\n${st.description}\n\n` +
    `Finde: berührte Files, Abhängigkeiten zu anderen Subtasks (${SUBTASKS.map(s => s.custom_id).join(', ')}), ` +
    `Komplexität, offene Fragen. Nichts ändern — nur lesen.`,
    { label: `scope:${st.custom_id}`, phase: 'Scope', schema: SCOPE }
  )
))
return map.filter(Boolean)
```

Im Main-Loop danach: gibt es `open_questions` oder File-Überschneidungen zwischen Subtasks
(→ relevant für Phase-3-Modus) → **Checkpoint**. Sonst Map kurz zusammenfassen, weiter.

---

## 2. Design-Judge-Panel (Phase 2, weiter/unklarer Lösungsraum)

Mehrere konkurrierende Entwürfe → parallel bewerten → besten zurückgeben. Für einen
**einzelnen** anspruchsvollen Task. Für klare Subtasks stattdessen schlicht „Plan je
Subtask" (pipeline, ein Agent pro Subtask).

```js
export const meta = {
  name: 'design-clickup-task',
  description: 'Generate competing designs for a task and pick the best via a judge panel',
  phases: [{ title: 'Entwürfe' }, { title: 'Bewertung' }],
}
const TASK = args.task   // {custom_id, name, description}
const ANGLES = ['MVP-zuerst', 'risiko-zuerst', 'an-bestehenden-Mustern-orientiert']
const PLAN = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    test_strategy: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['angle', 'steps', 'test_strategy', 'risks'],
}
const SCORE = {
  type: 'object',
  properties: { angle: { type: 'string' }, score: { type: 'number' }, why: { type: 'string' } },
  required: ['angle', 'score', 'why'],
}
const drafts = await parallel(ANGLES.map(a => () =>
  agent(`Entwirf einen Umsetzungsplan für ${TASK.custom_id} "${TASK.name}" aus Sicht „${a}".\n${TASK.description}`,
    { label: `draft:${a}`, phase: 'Entwürfe', schema: PLAN })
))
const valid = drafts.filter(Boolean)
const scores = await parallel(valid.map(d => () =>
  agent(`Bewerte diesen Plan (0–10) auf Machbarkeit, Risiko, Passung zum Code:\n${JSON.stringify(d)}`,
    { label: `judge:${d.angle}`, phase: 'Bewertung', schema: SCORE })
))
return { drafts: valid, scores: scores.filter(Boolean) }
```

Im Main-Loop: Sieger + Begründung dem User vorlegen, die besten Ideen der Runner-up nennen →
**Checkpoint** (Optionen + Empfehlung).

---

## 3. Review-find-verify (Phase 4)

Kanonisches Muster: Dimensionen → finden → adversarial verifizieren (pipeline, jede Dimension
verifiziert sobald ihr Review fertig ist).

```js
export const meta = {
  name: 'review-clickup-changes',
  description: 'Review the changes for a ClickUp task across dimensions, verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const DIMENSIONS = [
  { key: 'bugs', prompt: 'Logikfehler, Race Conditions, Null/Boundary in den geänderten Files.' },
  { key: 'security', prompt: 'Org-Isolation/Berechtigung, Injection, Datenleck in den geänderten Files.' },
  { key: 'konventionen', prompt: 'Abweichungen von den Projekt-Konventionen (CLAUDE.md, Nachbarschaftscode).' },
  { key: 'tests', prompt: 'Fehlende/zu schwache Tests für die neue Logik.' },
]
const FINDINGS = {
  type: 'object',
  properties: { findings: { type: 'array', items: {
    type: 'object',
    properties: { title: { type: 'string' }, file: { type: 'string' }, detail: { type: 'string' } },
    required: ['title', 'file', 'detail'],
  } } },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { isReal: { type: 'boolean' }, why: { type: 'string' } },
  required: ['isReal', 'why'],
}
const results = await pipeline(
  DIMENSIONS,
  d => agent(`Review die geänderten Files für ${args.custom_id} — Dimension „${d.key}": ${d.prompt}`,
    { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  review => parallel((review?.findings ?? []).map(f => () =>
    agent(`Versuche zu widerlegen: ${f.title} (${f.file}). ${f.detail}\nDefault: isReal=false bei Unsicherheit.`,
      { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, verdict: v }))
  ))
)
return results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
```

Im Main-Loop: bestätigte Findings abarbeiten (zurück in Phase 3), dann
`superpowers:requesting-code-review`.
