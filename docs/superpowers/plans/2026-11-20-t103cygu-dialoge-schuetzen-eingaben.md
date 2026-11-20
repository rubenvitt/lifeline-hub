# Dialoge schützen Eingaben — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erfassungsdialoge schließen nie über die Maske und fragen vor dem Verwerfen geänderter Eingaben nach.

**Architecture:** Der zentrale Abbruch `abbrechen` in `ErfassungsFormular` (`frontend/src/components/Erfassung.tsx`) kennt künftig den Änderungsstand (Felder per `onValuesChange` angefasst und anders als `initialValues`) und öffnet bei Änderung eine Rückfrage `VerwerfenDialog`. Alle Wege hinaus (Knopf, Escape über die Tastatur-Ebene, Kreuz über `steuerungRef`) laufen schon dort durch. `ErfassungsModal` und die vier Auftragsdialoge schalten die Maske ab und leiten das Kreuz über `steuerungRef`.

**Tech Stack:** React 19, antd 6 (`Modal`, `Form`), Vitest + Testing Library, Playwright. Node/pnpm nur über `mise exec --`.

**Spec:** `docs/superpowers/specs/2026-11-20-t103cygu-dialoge-schuetzen-eingaben-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/t103cygusr90pa1mcjc2zuw9

## Global Constraints

- Wortlaut fest: Titel „Eingaben verwerfen?“; Text „Die Eingaben in „<Titel>“ gehen verloren.“ (nur bei String-Titel), sonst „Die Eingaben gehen verloren.“; Knöpfe „Verwerfen“ (`danger`) und „Weiter bearbeiten“ (primär, Fokus).
- Knöpfe der Rückfrage in `Knopfreihe fuss` (ADR-0070); keine Abstands-Literale (ADR-0067).
- „Geändert“ = von der Person angefasst (`onValuesChange`) **und** ≠ `initialValues` nach `gleichFuerStand` (`components/aenderungsstand.tsx`). `setFieldsValue` allein zählt nie.
- Ohne Änderung schließen Escape, Kreuz und „Abbrechen“ sofort und still, wie heute.
- Die Maske schließt nie (`mask={{ closable: false }}`), auch nicht ohne Änderung.
- Während des Speicherns bleibt Abbrechen gesperrt (bestehende `sperrtAbbruch`-Logik).
- Bezeichner: Fachwörter deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“). Prosa, Testnamen und Commits deutsch.
- Gates: `mise exec -- pnpm -C frontend …`; kein `| tail` um Gate-Kommandos.

## Review Focus

1. Escape, während die Rückfrage offen ist: schließt nur die Rückfrage, keine zweite Rückfrage, der Erfassungsdialog bleibt mit Werten offen (Test in Task 1).
2. Serien-Speichern mit „Werte behalten“, danach Escape: keine Rückfrage, weil die angefassten Felder mit dem Reset geleert wurden (Test in Task 1).
3. Abbruch, während gespeichert wird (`speicherung.isPending`): weder Rückfrage noch Schließen (Test in Task 1).
4. Auftragsdialog mit `initialText` (aus ETB/Chat vorbelegt), ohne Bedienung geschlossen: keine Rückfrage (Test in Task 3).
5. Bestehende Tests in anderen Modulen, die tippen und dann abbrechen, erwarten das sofortige Schließen; sie müssen „Verwerfen“ klicken, nicht die Zusicherung verlieren (Task 4, Schritt 1).

---

### Task 1: Änderungsstand und Rückfrage im `ErfassungsFormular`

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx` (Props, `abbrechen`, `<Form onValuesChange>`, Reset-Stellen, Tastatur-Ebene, Dateikopf Zusicherung 3)
- Modify: `frontend/src/components/VerlassenRueckfrage.tsx` (neuer Export `VerwerfenDialog`) — oder eigene Datei `components/VerwerfenDialog.tsx`, Wahl des Umsetzers
- Test: `frontend/src/components/Erfassung.test.tsx`

**Interfaces:**
- Produces: `VerwerfenDialog(props: { offen: boolean; titel?: ReactNode; onWeiter: () => void; onVerwerfen: () => void })`
- Produces: neue optionale Prop an `ErfassungsFormularProps`: `rueckfrageTitel?: ReactNode` (Titel des Dialogs für den Rückfragetext)
- Unverändert: `ErfassungsFormularSteuerung.abbrechen()` — fragt künftig bei Änderung nach, statt sofort zu leeren.

- [ ] **Step 1: Failing Tests schreiben** (neuer `describe('ErfassungsFormular — Rückfrage vor dem Verwerfen (LLH-1755)')`, mit `Harness`)
  - `ohne Änderung schließt Abbrechen sofort und still` — Klick „Abbrechen“ → `onAbbrechen` 1×, kein Dialog „Eingaben verwerfen?“.
  - `mit Änderung fragt Abbrechen nach; „Weiter bearbeiten“ behält die Werte` — „Brücke“ tippen, „Abbrechen“ → `getByRole('dialog', { name: 'Eingaben verwerfen?' })`; `onAbbrechen` 0×; „Weiter bearbeiten“ → Dialog weg, Ort = „Brücke“, `onAbbrechen` 0×.
  - `„Verwerfen“ leert und meldet den Abbruch` — danach Ort = „“, `onAbbrechen` 1×.
  - `der Fokus steht in der Rückfrage auf „Weiter bearbeiten“ und kehrt danach ins Feld zurück`.
  - `getippt und wieder gelöscht gilt als unverändert` — „x“ tippen, `{Backspace}`, Abbrechen → keine Rückfrage.
  - `setFieldsValue allein fragt nicht` — `form.setFieldsValue({ ort: 'Vorbelegt' })` per `act`, Abbrechen → keine Rückfrage.
  - `nach einem Serien-Speichern mit „Werte behalten“ fragt Abbrechen nicht` — `serie`, `uebernahme={['ort']}`, Schalter an, tippen, „Speichern und nächste“, dann Abbrechen → keine Rückfrage.
  - `Escape in der Rückfrage schließt nur die Rückfrage` — Rückfrage offen, `{Escape}` → Rückfrage weg, Ort = „Brücke“, kein erneuter Dialog, `onAbbrechen` 0×.
  - `der äußere Abbruch über steuerungRef fragt bei Änderung ebenso nach`.
  - `während des Speicherns fragt und schließt der Abbruch nicht` — `onErfassen` als offenes Promise, `speicherung={{ isPending: true, error: null, reset }}`, `steuerung.current.abbrechen()` → keine Rückfrage, `onAbbrechen` 0×.
- [ ] **Step 2: Tests laufen lassen, sie scheitern**
  Run: `mise exec -- pnpm -C frontend vitest run src/components/Erfassung.test.tsx`
  Expected: FAIL in den neuen Fällen (kein Dialog „Eingaben verwerfen?“).
- [ ] **Step 3: Umsetzen**
  - `VerwerfenDialog`: antd `Modal` mit `title="Eingaben verwerfen?"`, `onCancel={onWeiter}` (Escape und Kreuz = weiter bearbeiten), `mask={{ closable: false }}`, Fuß `Knopfreihe fuss` mit „Verwerfen“ (`danger`) und „Weiter bearbeiten“ (`type="primary"`, `autoFocus`). Escape darf nicht zur Tastatur-Ebene des Formulars durchreichen (etwa `onKeyDown` am Dialog-Inhalt mit `stopPropagation`, oder die Ebene über `aktiv` abschalten — Umsetzer wählt, Test aus Step 1 entscheidet).
  - In `ErfassungsFormular`: `touchedFieldsRef = useRef(new Set<string>())`, gefüllt aus `onValuesChange(changed)` mit den obersten Schlüsseln; geleert an jeder `form.resetFields()`-Stelle (Erfolg, Serie, Verwerfen). `hasAenderungen(): boolean` prüft je angefasstem Feld `!gleichFuerStand(form.getFieldValue(name), initialValues?.[name])`.
  - `abbrechen`: gesperrt → return (wie heute); Rückfrage offen → return; `hasAenderungen()` → `document.activeElement` merken, Rückfrage öffnen; sonst bisheriger Ablauf (in eine Funktion `verwerfen()` ausgelagert, die auch „Verwerfen“ ruft). „Weiter bearbeiten“ schließt die Rückfrage und gibt den Fokus an das gemerkte Element zurück, sonst an das erste Feld.
  - Dateikopf Zusicherung 3 ergänzen: mit Änderung fragt jeder Weg hinaus vorher nach; „geändert“ wie oben.
- [ ] **Step 4: Bestehende Tests der Datei nachziehen** — `leert die Felder auch beim Abbrechen` und `führt einen äußeren Drawer-Abbruch über denselben Reset-Pfad` klicken nach dem Abbruch „Verwerfen“; `führt nach Abbruch während des Akzeptanz-Hooks keinen späten Abschluss aus` prüfen und ebenso anpassen, ohne seine Aussage zu schwächen.
- [ ] **Step 5: Tests grün**
  Run: `mise exec -- pnpm -C frontend vitest run src/components/Erfassung.test.tsx src/components/VerlassenRueckfrage.test.tsx`
  Expected: PASS
- [ ] **Step 6: Commit** — `feat: Erfassungsformular fragt vor dem Verwerfen geänderter Eingaben (LLH-1755)` mit Zunder-Zeile.

### Task 2: `ErfassungsModal` — Maske schließt nie, Titel in die Rückfrage

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx` (`ErfassungsModal`, Kommentar darüber)
- Test: `frontend/src/components/Erfassung.test.tsx` (`describe('ErfassungsModal')`)

**Interfaces:**
- Consumes: `rueckfrageTitel` aus Task 1; `ErfassungsModal` reicht `titel` dorthin.

- [ ] **Step 1: Failing Tests**
  - `ein Klick auf die Maske schließt nie, auch ohne Änderung` — `document.querySelector('.ant-modal-wrap')` per `fireEvent.mouseDown` + `fireEvent.click` (wie antd es auslöst) → `onAbbrechen` 0×, Dialog „Person erfassen“ noch da.
  - `Escape und Kreuz mit Änderung fragen nach und nennen den Dialog` — je Weg: tippen, auslösen → Text „Die Eingaben in „Person erfassen“ gehen verloren.“; „Verwerfen“ → Ort leer, `onAbbrechen` 1×.
  - Bestehenden Test `leert die Felder auch über Escape und das Schliesskreuz…` umbauen: ohne Änderung schließen beide sofort (`onAbbrechen` 1×); die Leer-Aussage nach „Verwerfen“ deckt der vorige Fall. `Escape läuft genau einmal über die Registry…` klickt nach Escape „Verwerfen“ und behält „genau einmal“.
- [ ] **Step 2: Run, FAIL** — `mise exec -- pnpm -C frontend vitest run src/components/Erfassung.test.tsx -t ErfassungsModal`
- [ ] **Step 3: Umsetzen** — `mask={{ closable: false }}` fest; `rueckfrageTitel={titel}` an `ErfassungsFormular`. Kommentar am `ErfassungsModal`: vier Auswege → drei, Maske schließt nie (LLH-1755).
- [ ] **Step 4: Run, PASS** (gleiches Kommando).
- [ ] **Step 5: Commit** — `feat: Erfassungsdialog schließt nicht über die Maske (LLH-1755)`.

### Task 3: Auftragsdialoge über dieselbe Pforte

**Files:**
- Modify: `frontend/src/auftraege/AuftragFormular.tsx` (Props: `steuerungRef?: Ref<ErfassungsFormularSteuerung>`, `rueckfrageTitel?: ReactNode`; an `ErfassungsFormular` durchreichen)
- Modify: `frontend/src/auftraege/AuftragErteilenDialog.tsx`, `frontend/src/meldungen/AuftragErteilenModal.tsx`, `frontend/src/etb/AuftragAusEtbModal.tsx`, `frontend/src/chat/HeraufstufenAuftragModal.tsx`
- Test: je Modal die vorhandene `*.test.tsx` daneben (fehlt sie, neu anlegen nach dem Muster der vorhandenen Auftragstests)

**Interfaces:**
- Consumes: `ErfassungsFormularSteuerung` (Task 1).
- Produces: `AuftragFormular`-Props `steuerungRef`, `rueckfrageTitel`.

- [ ] **Step 1: Failing Tests** (je Modal ein `describe`, `it`-Namen gleich):
  - `die Maske schließt den Dialog nicht` — wie Task 2.
  - `das Kreuz fragt bei geändertem Auftragstext nach` — in „Auftrag / Was“ tippen, Kreuz → „Eingaben verwerfen?“; „Verwerfen“ → `onSchliessen`/`onAbbrechen` 1×.
  - `vorbelegt und unbedient schließt das Kreuz still` — für `AuftragAusEtbModal` und `HeraufstufenAuftragModal` (vorbelegter Text aus `initialText`), Kreuz → Abbruch-Callback 1×, keine Rückfrage.
  - `Escape läuft genau einmal` — `{Escape}` ohne Änderung → Abbruch-Callback genau 1×.
- [ ] **Step 2: Run, FAIL** — `mise exec -- pnpm -C frontend vitest run src/auftraege src/meldungen src/etb/AuftragAusEtbModal src/chat/HeraufstufenAuftragModal`
- [ ] **Step 3: Umsetzen** — je Modal `useRef<ErfassungsFormularSteuerung>(null)`; `onCancel={() => steuerung.current?.abbrechen()}`; `mask={{ closable: false }}`; `keyboard={false}` (Escape läuft über die Tastatur-Ebene des Formulars, sonst doppelt); `closable` gesperrt wie bisher. Was `onCancel` heute zusätzlich tut (`speicherung.reset()` in `AuftragAusEtbModal`), wandert in den Abbruch-Callback, den `AuftragFormular` an `onAbbrechen` der Hülle gibt — prüfen, dass `AuftragFormular` einen solchen Callback hat; sonst Prop `onAbbrechen` ergänzen und im Interfaces-Block oben nachtragen. Kommentar in `AuftragErteilenDialog` („so setzt jeder Weg hinaus … zurück“) auf den neuen Stand.
- [ ] **Step 4: Run, PASS** (gleiches Kommando).
- [ ] **Step 5: Commit** — `feat: Auftragsdialoge fragen vor dem Verwerfen und schließen nicht über die Maske (LLH-1755)`.

### Task 4: Regel, Folgetests, e2e

**Files:**
- Modify: `frontend/AGENTS.md` („Erfassungs-Norm“, Punkt „Zurückgesetzt wird auf JEDEM Weg hinaus“)
- Modify: Tests anderer Module, die nach Task 1–3 scheitern
- Create: `frontend/e2e/dialog-rueckfrage.spec.ts`
- Ggf. Modify: `docs/design/design-system/project/**` (erzeugt)

- [ ] **Step 1: Volle Unit-Suite** — `mise exec -- pnpm -C frontend vitest run`. Jeder rote Test, der tippt und dann abbricht: nach dem Abbruch „Verwerfen“ klicken. Keinen Test löschen oder überspringen.
- [ ] **Step 2: Regel** — Punkt in `frontend/AGENTS.md` ergänzen: „Mit geänderten Feldern fragt jeder Weg hinaus vorher nach („Eingaben verwerfen?“, `VerwerfenDialog`); die Maske schließt nie. „Geändert“ heißt: angefasst und anders als `initialValues` (LLH-1755, Design-Doc `docs/superpowers/specs/2026-11-20-t103cygu-dialoge-schuetzen-eingaben-design.md`).“ Prettier: `mise exec -- pnpm -C frontend prettier --check AGENTS.md`.
- [ ] **Step 3: Design System** — `mise exec -- pnpm -C frontend vitest run src/designSystem.guard.test.ts` (Pfad per `find frontend -name designSystem.guard.test.ts`). Rot oder README trägt die Erfassungs-Norm → `mise exec -- pnpm -C frontend design-system` und Erzeugtes mitcommitten.
- [ ] **Step 4: e2e** — Spec `Vermisst melden: Escape mit Name fragt nach, „Weiter bearbeiten“ behält den Namen; Klick neben den Dialog schließt nicht`. Einstieg wie in `frontend/e2e/personen-aufnahme.spec.ts` (Login, Demo-Einsatz). Run: `mise exec -- pnpm -C frontend e2e dialog-rueckfrage --trace off`. Läuft der Stack in der Sitzung nicht, festhalten und im PR nennen.
- [ ] **Step 5: Gate** — `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 6: Commit** — `docs: Erfassungs-Norm fragt vor dem Verwerfen (LLH-1755)` bzw. `test: …` je Inhalt.
