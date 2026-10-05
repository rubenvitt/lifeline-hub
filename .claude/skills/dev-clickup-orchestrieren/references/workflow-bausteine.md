# Workflow-Bausteine

Fertige, adaptierbare Skripte für die Fan-out-Phasen. Kopieren, Platzhalter (`<…>`) füllen,
Subtask-Liste/Pfade einsetzen. Alle laufen über das **Workflow-Tool** (Hintergrund, keine
User-Interaktion im Lauf). Ergebnisse landen im Main-Loop → dort Checkpoint/Entscheidung.

Ein Skelett muss nicht als Workflow laufen: Bei wenigen Jobs startest du dieselben Prompts als
einzelne Subagents (Agent-Tool) und führst die Ergebnisse im Main-Loop zusammen. Die Wahl
triffst du selbst, ohne Opt-in (`dev-clickup-ausfuehren`, Abschnitt „Agenten nach Bedarf“). Die
Grundregeln unten gelten für Subagents genauso, und jeder Subagent-Prompt bringt die
Pflichtpunkte aus jenem Abschnitt mit.

Grundregeln (aus der Workflow-Tool-Doku):
- `pipeline()` ist der Default für Mehrstufiges ohne Barriere. `parallel()` nur, wenn du
  **alle** Ergebnisse gemeinsam brauchst (Dedup, Early-Exit, Synthese).
- Mit `schema` gibt `agent()` ein validiertes Objekt zurück — kein Parsen nötig.
- `meta` muss ein reines Literal sein (keine Variablen/Aufrufe).
- Modell weglassen → Agent erbt das Session-Modell (fast immer richtig).
- **Kein `/opsx:*` in einem Workflow** (`explore`, `propose`, `update`, `apply`, `archive`),
  und kein Workflow legt unter `openspec/changes/` etwas an oder ändert dort etwas (LFH-589,
  Spec `entwurfs-hoheit`). Die Skelette unten **lesen nur**. Die Change eines Tasks entsteht
  im Main-Loop über `/opsx:propose`, danach folgt der Freigabe-Checkpoint. Einzige Ausnahme ist
  der autonome Dev-Modus (Phase 3): Er hakt Aufgaben einer **freigegebenen** Change ab.

---

## 1. Scope-Fan-out (Phase 1)

Pro Subtask ein Reader-Agent; alle Ergebnisse für die Map zusammenführen (Barriere ist hier
korrekt, weil die Map cross-subtask-Abhängigkeiten braucht). Jeder Reader schlägt die **Route**
vor (Schlüssel aus dem Routing von `dev-clickup-ausfuehren`, Schritt 3). Die Route `entwurf` ist
der einzige Weg zu einer OpenSpec-Change. Die Gründe E1–E3 stehen im Prompt, weil ein
Workflow-Agent den Skill nicht selbst liest. Ändert sich das Kriterium dort, hier nachziehen.

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
    route: { enum: ['trivial', 'klar', 'bug-unklar', 'unklar', 'entwurf'] },
    entwurfsgruende: { type: 'array', items: { enum: ['E1', 'E2', 'E3'] } }, // leer außer bei 'entwurf'
    faehigkeiten: { type: 'array', items: { type: 'string' } }, // Pfade unter openspec/specs/, deren Anforderungen der Subtask ändert oder neu anlegt
    open_questions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['custom_id', 'files', 'depends_on', 'route', 'entwurfsgruende', 'faehigkeiten',
    'open_questions', 'summary'],
}
const ROUTEN =
  'Route: trivial (Typo/Text) · klar (Feature/Bugfix mit klarer Spec) · bug-unklar (Bug, Ursache unklar) · ' +
  'unklar (Anforderung unklar) · entwurf. entwurf gilt, sobald mindestens ein Grund zutrifft, und geht vor: ' +
  'E1 mehr als ein vertretbarer Weg, Wahl soll begründet bleiben; ' +
  'E2 führt eine Regel ein oder ändert sie, die über den Task hinaus gilt (Fähigkeits-Anforderung, AGENTS.md-Dateien, .claude/); ' +
  'E3 mehr als ein Subsystem — Backend (src/, migrations/, tests/), Frontend (frontend/), Hülle (src-tauri/), ' +
  'Gate/CI (scripts/, .github/), Arbeitsanleitungen (.claude/, AGENTS.md-Dateien); Pfade außerhalb dieser Liste ' +
  'zählen zu keinem Subsystem; E3 nicht bei einem Bugfix, der vorhandenes Verhalten wiederherstellt, ' +
  'und nicht bei einer reinen Text-/Tippfehlerkorrektur.'
const map = await parallel(SUBTASKS.map(st => () =>
  agent(
    `Scope subtask ${st.custom_id} "${st.name}" against this codebase.\n` +
    `Beschreibung:\n${st.description}\n\n` +
    `Finde: berührte Files, Abhängigkeiten zu anderen Subtasks (${SUBTASKS.map(s => s.custom_id).join(', ')}), ` +
    `Fähigkeiten unter openspec/specs/, deren Anforderungen der Subtask ändert oder neu anlegt (bloßes Berühren zählt nicht), ` +
    `offene Fragen, und schlage die Route vor.\n${ROUTEN}\n` +
    `Nichts ändern — nur lesen. Kein /opsx:* ausführen.`,
    { label: `scope:${st.custom_id}`, phase: 'Scope', schema: SCOPE }
  )
))
return map.filter(Boolean)
```

Im Main-Loop danach:
- **Routen bestätigen.** E3 an den `files` nachprüfen und strittige Routen korrigieren.
- Für jeden Eintrag mit `route: 'unklar'` läuft **`/opsx:explore` im Main-Loop**, danach wird
  neu geroutet.
- Gibt es `open_questions`, File-Überschneidungen zwischen Subtasks (→ relevant für den
  Phase-3-Modus) oder eine strittige Route → **Checkpoint**. Sonst Map samt Routen kurz
  zusammenfassen und weiter.
- Die Einträge mit `route: 'entwurf'` sind die Eingabe für Phase 2 (`/opsx:propose` je Task).
  Überschneiden sich zwei Subtasks **auf `entwurf`** in `faehigkeiten`, bekommen sie eine
  gemeinsame Change am Parent. Ein Subtask auf einer anderen Route bleibt ohne Change.
  Subtasks einer gemeinsamen Change laufen in Phase 3 nie parallel autonom.

---

## 2. Design-Judge-Panel (Phase 2, Zulieferer für `/opsx:propose`)

Mehrere konkurrierende Entwürfe → parallel bewerten → besten zurückgeben. Nur für einen
**einzelnen** Task auf `route: 'entwurf'` mit weitem Lösungsraum (E1, mehr als zwei ernsthafte
Wege). Das Panel **schreibt nichts**. Sein Ergebnis ist Eingabe für `/opsx:propose` im
Main-Loop, das die Change schreibt. Für alle anderen Tasks gibt es in Phase 2 keinen Workflow:
Die `tasks.md` der Change ist der Plan, und Tasks ohne `entwurf` brauchen keinen.

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
  agent(`Entwirf einen Umsetzungsplan für ${TASK.custom_id} "${TASK.name}" aus Sicht „${a}".\n${TASK.description}\n` +
    `Nur lesen: keine Datei anlegen oder ändern, kein /opsx:* ausführen.`,
    { label: `draft:${a}`, phase: 'Entwürfe', schema: PLAN })
))
const valid = drafts.filter(Boolean)
const scores = await parallel(valid.map(d => () =>
  agent(`Bewerte diesen Plan (0–10) auf Machbarkeit, Risiko, Passung zum Code:\n${JSON.stringify(d)}`,
    { label: `judge:${d.angle}`, phase: 'Bewertung', schema: SCORE })
))
return { drafts: valid, scores: scores.filter(Boolean) }
```

Im Main-Loop: **kein eigener Halt.** Sieger und Runner-ups gehen als Eingabe an
`/opsx:propose`. Der Sieger wird die Entscheidung in `design.md`, die übrigen stehen dort als
verworfene Alternativen samt Grund. Die Wahl trifft der Mensch am **Freigabe-Checkpoint** nach
`/opsx:propose`, zusammen mit den übrigen Changes des Laufs. Will er einen anderen Weg, läuft
`/opsx:update`.

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
  { key: 'konventionen', prompt: 'Abweichungen von den Projekt-Konventionen (AGENTS.md-Dateien, Nachbarschaftscode).' },
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
