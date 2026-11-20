# Pflichtfeld-Fehler ins Bild; eigene Stelle in der Meldung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gescheiterte Prüfung in jedem Erfassungsformular sichtbar machen (rollen, Fokus, Fehlerzeile am Knopf) und im Meldungsformular die eigene Stelle nach Art vorbelegen.

**Architecture:** Rollen und Fehlerzeile leben in der Hülle `components/Erfassung.tsx` (`ErfassungsFormular`). Die Vorbelegung bekommt `MeldungFormular` als Prop `eigeneStelle`, die Seiten lesen sie aus `useStandardRufname()`.

**Tech Stack:** React, antd `Form`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-20-xqrd448y-pflichtfehler-im-bild-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/xqrd448ygruaijmom9oz49xe

## Global Constraints

- Kein Toast, kein Modal für Prüffehler (`frontend/AGENTS.md`, „Rückwege und Fehler“).
- Eine Vorgabe überschreibt nie einen eingetragenen oder angefassten Wert.
- Fehlerzeile: Alarmfarbe **und** Wort (Fehlertexte), `aria-live`, Primärknopf `aria-describedby`.
- Vorgabe je Art: sonst Empfänger = `standard.an`; Art `lagemeldung` Absender = `standard.von`.
- Prosa/Kommentare deutsch, neue Bezeichner nach `AGENTS.md`, „Bezeichner-Sprache“.

## Review Focus

- Fehler in einem eingeklappten Feld („Weitere Angaben“): erst aufklappen, dann rollen (Task 1, Test „rollt nach dem Aufklappen“ über `onPruefungGescheitert`-Reihenfolge).
- Fehlerzeile bleibt nach Abbrechen/Erfassen stehen → muss weg (Task 1).
- Wechsel der Art nachdem die Vorgabe stand: Vorgabe tauscht, eigene Eingabe bleibt (Task 2).
- Standard kommt asynchron nach dem ersten Render (Task 2: Rerender mit `eigeneStelle`).
- „Werte behalten“ aus: nach Reset steht die Vorgabe wieder (Task 2).

---

### Task 1: Hülle rollt zum ersten Fehler und nennt die Fehler am Knopf

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx` (`onFinishFailed`, Aktionszeile, Reset-Wege)
- Test: `frontend/src/components/Erfassung.test.tsx`
- Modify: `frontend/AGENTS.md`, Abschnitt „Frontend — Erfassungs-Norm“ (eine Zeile)

**Interfaces:**
- Produces: `data-lfh="erfassung-pruefung"` an der Fehlerzeile; keine neue Prop.

- [x] **Step 1: Failing tests** in `describe('Prüfung gescheitert (LLH-1759)')`:
  - `rollt zum ersten fehlerhaften Feld und fokussiert es` — `Element.prototype.scrollIntoView` per `vi.fn` stubben; leeres Pflichtfeld absenden; erwarten: `scrollIntoView` aufgerufen mit `expect.objectContaining({ block: 'center' })`, `document.activeElement` ist das erste Pflichtfeld.
  - `nennt die Fehler am Knopf` — Zeile `[data-lfh="erfassung-pruefung"]` enthält beide Fehlertexte, Primärknopf `aria-describedby` zeigt auf ihre `id`.
  - `die Zeile verschwindet, sobald die Felder stimmen` — Felder füllen → Zeile weg.
  - `Abbrechen räumt die Zeile` — Abbrechen → Zeile weg.
  - `ruft onPruefungGescheitert vor dem Rollen` — Reihenfolge über ein Array, in das beide Callbacks schreiben.
- [x] **Step 2:** `mise exec -- pnpm vitest run src/components/Erfassung.test.tsx` → neue Tests FAIL.
- [x] **Step 3: Implementieren.** State `pruefFehler: string[]`; in `onFinishFailed` aus `errorFields` die Fehlertexte setzen, `onPruefungGescheitert` rufen, dann `requestAnimationFrame(() => form.scrollToField(errorFields[0].name, { block: 'center', focus: true }))`. `onFieldsChange` am `Form`: solange `pruefFehler` nicht leer, aus `form.getFieldsError()` neu berechnen. Reset in `abschicken` und `abbrechen` leert. Zeile als `Typography.Text type="danger"` mit `aria-live="polite"`, über der Knopfreihe; `aria-describedby` am Primärknopf vereint Zusammenfassung und Fehlerzeile.
- [x] **Step 4:** Tests PASS, ganze Datei grün.
- [x] **Step 5:** Zeile in der Erfassungs-Norm ergänzen; Commit `feat(erfassung): bei gescheiterter Prüfung zum Fehler rollen und ihn am Knopf nennen`.

### Task 2: Meldungsformular belegt die eigene Stelle nach Art vor

**Files:**
- Modify: `frontend/src/meldungen/MeldungFormular.tsx`
- Modify: `frontend/src/pages/MeldungenPage.tsx`, `frontend/src/pages/LagemeldungenPage.tsx` (Prop durchreichen)
- Test: `frontend/src/meldungen/MeldungFormular.test.tsx`

**Interfaces:**
- Consumes: `StandardRufname` aus `etb/standardRufname.ts`, `useStandardRufname()` aus `etb/useStandardRufname.ts`.
- Produces: Prop `eigeneStelle?: StandardRufname | null` an `MeldungFormular`.

- [x] **Step 1: Failing tests** in `describe('MeldungFormular — eigene Stelle (LLH-1759)')` mit `eigeneStelle={{ von: 'ELW 1', an: 'ELW 1 EL' }}`:
  - `belegt bei einer Meldung den Empfänger vor, nicht den Absender` — Empfänger `ELW 1 EL`, Absender leer.
  - `belegt bei einer Lagemeldung den Absender vor` (`artVorgabe="lagemeldung"`) — Absender `ELW 1`.
  - `der Fast-Path Lagemeldung tauscht die unangefasste Vorgabe` — Empfänger leer, Absender `ELW 1`.
  - `überschreibt keinen eingetragenen Empfänger` — Empfänger tippen, dann Fast-Path Lagemeldung → Empfänger bleibt.
  - `greift auch, wenn der Standard erst später kommt` — Rerender von `null` auf Standard.
  - `nach dem Erfassen steht die Vorgabe wieder` — erfassen ohne „Werte behalten“ → Empfänger wieder `ELW 1 EL`.
  - `ohne eigene Stelle bleibt alles leer`.
- [x] **Step 2:** `mise exec -- pnpm vitest run src/meldungen/MeldungFormular.test.tsx` → FAIL.
- [x] **Step 3: Implementieren.** Effekt auf `[meldungsart, eigeneStelle, absender, empfaenger]` (Watch): Zielfeld nach Art bestimmen; Zielfeld setzen, wenn leer und nicht angefasst; das andere Feld leeren, wenn es genau der Vorgabe entspricht und nicht angefasst ist. Seiten reichen `useStandardRufname().standard` durch.
- [x] **Step 4:** Tests PASS, ganze Datei grün.
- [x] **Step 5:** Commit `feat(meldungen): eigene Stelle nach Art vorbelegen wie im ETB`.

### Task 3: Prüfen

- [x] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [x] Bilder am schmalen Schirm (vorher/nachher) für den PR.
