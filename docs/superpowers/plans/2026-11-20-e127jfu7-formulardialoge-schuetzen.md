# Handgebaute Dialoge schützen Eingaben — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Zunder: https://zunder.rubeen.dev/#/aufgabe/e127jfu7zghh3h7z17tbbaw0

**Goal:** Kein Dialog mit Eingabe schließt per Maske, und getippte Eingaben gehen nie ohne „Eingaben verwerfen?“ verloren — auch in den handgebauten `<Modal>`-Dialogen.

**Architecture:** Zwei antd-Form-Dialoge kommen auf `ErfassungsModal` (LLH-1755 schützt sie dort). Einfelddialoge und die Postenliste bekommen einen Hook `useVerwerfenSchutz`, der Modal-Props und die Rückfrage liefert. Auswahldialoge sperren nur die Maske. Ein Quelltext-Wächter hält den Stand.

**Tech Stack:** React 19, antd 6, Vitest + Testing Library, `mise exec -- pnpm -C frontend …`.

**Spec:** `docs/superpowers/specs/2026-11-20-e127jfu7-formulardialoge-schuetzen-design.md` (baut auf `docs/superpowers/specs/2026-11-20-t103cygu-dialoge-schuetzen-eingaben-design.md`, LLH-1755).

## Global Constraints

- Branch ist auf `claude/brave-meitner-1oyvfo` (LLH-1755) gestapelt; `VerwerfenDialog` und `MASKE_HAELT_FOKUS` kommen von dort.
- Wortlaut der Rückfrage ausschließlich über `VerwerfenDialog` („Eingaben verwerfen?“, „Die Eingaben in „<Titel>“ gehen verloren.“, „Verwerfen“, „Weiter bearbeiten“).
- Maskensperre immer als `mask={{ closable: false }}` plus `wrapProps={MASKE_HAELT_FOKUS}`.
- Während gespeichert wird, bleibt jeder Weg hinaus gesperrt wie heute.
- Bezeichner: Fachwort deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa, Testnamen deutsch.
- Kein Test wird gelöscht oder übersprungen; Tests, die über die Maske schlossen, werden umgeschrieben.

## Review Focus

- Escape bei offener Rückfrage darf den Dialog darunter nicht schließen (antd hört Escape global) → Hook-Test Task 1.
- Nach „Weiter bearbeiten“ steht der Fokus wieder im Feld, sonst hört der Dialog kein Escape mehr → Hook-Test Task 1.
- Nach „Verwerfen“ und erneutem Öffnen ist der Dialog leer und fragt beim nächsten Schließen ohne Eingabe nicht → Test Task 2 (Vollzug).
- Umbenennen ohne Änderung des Namens schließt still → Test Task 3.
- Vorbelegter Lage-Text allein löst keine Rückfrage aus → Test Task 5.

---

### Task 1: Hook `useVerwerfenSchutz`

**Files:**
- Modify: `frontend/src/components/VerlassenRueckfrage.tsx` (Hook neben `VerwerfenDialog`)
- Test: `frontend/src/components/useVerwerfenSchutz.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function useVerwerfenSchutz(o: {
    geaendert: boolean;
    gesperrt?: boolean;
    titel?: ReactNode;
    onSchliessen: () => void;
  }): {
    modalProps: Pick<ModalProps, 'mask' | 'wrapProps' | 'onCancel' | 'keyboard'>;
    /** Abbruch für eigene Abbrechen-Knöpfe; derselbe Weg wie onCancel. */
    abbrechen: () => void;
    rueckfrage: ReactNode;
  };
  ```

- [x] **Step 1: Failing tests** in `useVerwerfenSchutz.test.tsx` mit einer Testkomponente (`<Modal title="Probe" open {...schutz.modalProps}><Input aria-label="Text" value onChange /></Modal>{schutz.rueckfrage}`, `geaendert = text.trim() !== ''`):
  - „ohne Eingabe schließt das Kreuz sofort“ → `onSchliessen` 1×, `queryByText(/gehen verloren\./)` null.
  - „die Maske schließt nicht“ → Klick auf `.ant-modal-wrap` mit Eingabe und ohne: `onSchliessen` 0×.
  - „mit Eingabe fragt das Kreuz nach; Weiter bearbeiten behält den Text und den Fokus“ → Text `"abc"`, Kreuz, Text „Die Eingaben in „Probe“ gehen verloren.“, „Weiter bearbeiten“ → `onSchliessen` 0×, Feld hat `"abc"` und `toHaveFocus()`.
  - „Verwerfen schließt“ → `onSchliessen` 1×.
  - „Escape bei offener Rückfrage schließt nur die Rückfrage“ → Escape im Feld öffnet Rückfrage, zweites Escape: Rückfrage weg, `onSchliessen` 0×.
  - „gesperrt tut nichts“ → `gesperrt: true`, Kreuz: `onSchliessen` 0×, keine Rückfrage.
  - „abbrechen() fragt wie das Kreuz“ → eigener Knopf „Abbrechen“ ruft `schutz.abbrechen`.
- [x] **Step 2:** `mise exec -- pnpm -C frontend vitest run src/components/useVerwerfenSchutz.test.tsx` → FAIL (Export fehlt).
- [x] **Step 3: Implement.** Zustand `rueckfrageOffen`; beim Öffnen der Rückfrage `document.activeElement` merken und nach „Weiter bearbeiten“ per `requestAnimationFrame`/`setTimeout(0)` fokussieren. `keyboard: !gesperrt && !rueckfrageOffen`. `rueckfrage` = `<VerwerfenDialog offen={rueckfrageOffen} titel={titel} onWeiter=… onVerwerfen=… />`. JSDoc nennt `frontend/AGENTS.md`, „Erfassungs-Norm“, und dass `rueckfrage` neben, nicht in das `<Modal>` gehört.
- [x] **Step 4:** Test-Befehl aus Step 2 → PASS.
- [x] **Step 5: Commit** `feat: Hook useVerwerfenSchutz für handgebaute Dialoge (LLH-2010)`.

### Task 2: Vollzug melden, Nachforderung ablehnen und zurückziehen

**Files:**
- Modify: `frontend/src/auftraege/VollzugMeldenModal.tsx`, `frontend/src/pages/NachforderungenPage.tsx` (Modals „Nachforderung ablehnen“ ≈:1155, „Nachforderung zurückziehen“ ≈:1191)
- Test: `frontend/src/auftraege/VollzugMeldenModal.test.tsx` (anlegen oder erweitern), bestehender Test der NachforderungenPage (per `ls frontend/src/pages/Nachforderungen*.test.tsx`)

**Interfaces:** Consumes `useVerwerfenSchutz` (Task 1).

- [x] **Step 1: Failing tests:**
  - Vollzug: „Maske schließt nicht“, „Kreuz mit Text fragt nach“, „Kreuz ohne Text schließt“, „nach Verwerfen und erneutem Öffnen ist das Feld leer und das Kreuz schließt still“.
  - Ablehnen: „Kreuz mit Grund fragt nach, ohne Grund schließt“, „Maske schließt nicht“. Zurückziehen: dasselbe.
- [x] **Step 2:** Tests laufen lassen → FAIL.
- [x] **Step 3: Implement.** Je Modal `useVerwerfenSchutz({ geaendert: text.trim() !== '', gesperrt: meldet|lehntAb|zieht, titel, onSchliessen: <bisheriger onCancel-Körper> })`; `{...schutz.modalProps}` ersetzt `mask`, `keyboard`, `onCancel`; `closable`, `confirmLoading`, `cancelButtonProps` bleiben. `schutz.rueckfrage` als Geschwister rendern (in der Page in ein Fragment neben dem Modal).
- [x] **Step 4:** Tests → PASS; bestehende Tests der Dateien grün.
- [x] **Step 5: Commit** `feat: Vollzug und Nachforderungsgründe fragen vor dem Verwerfen (LLH-2010)`.

### Task 3: Ansicht anlegen/umbenennen, Postenliste der Unterkunft

**Files:**
- Modify: `frontend/src/pages/lagekarte/AnsichtSwitcher.tsx` (≈:192), `frontend/src/betreuung/unterkunft/NachforderungenDialog.tsx` (≈:160)
- Test: vorhandene Tests der beiden Dateien erweitern (sonst `AnsichtSwitcher.test.tsx` / `NachforderungenDialog.test.tsx` anlegen)

**Interfaces:** Consumes `useVerwerfenSchutz`.

- [x] **Step 1: Failing tests:**
  - Neue Ansicht: „Kreuz mit Name fragt nach“, „Maske schließt nicht“.
  - Umbenennen: „unveränderter Name schließt still“, „geänderter Name fragt nach“.
  - Postenliste: „unverändert schließt ‚Schließen‘ still“, „nach Haken an einer Zeile fragt ‚Schließen‘ nach“, „Maske schließt nicht“.
- [x] **Step 2:** → FAIL.
- [x] **Step 3: Implement.** Ansicht: `geaendert = nameDialog?.modus === 'umbenennen' ? nameWert.trim() !== (aktive?.name ?? '') : nameWert.trim() !== ''` (Ausgangsname aus dem Zustand beim Öffnen nehmen, falls `aktive` dort nicht der umbenannte ist). Postenliste: Startzeilen beim Einhängen per `useState(() => zeilen)` merken; `geaendert`, wenn `an` oder Menge einer Zeile abweicht. `cancelText="Schließen"` bleibt; `onCancel` aus dem Hook, `gesperrt: laeuft`.
- [x] **Step 4:** → PASS.
- [x] **Step 5: Commit** `feat: Ansichtsname und Postenliste fragen vor dem Verwerfen (LLH-2010)`.

### Task 4: „Baustein einsetzen“ auf `ErfassungsModal`

**Files:**
- Modify: `frontend/src/etb/BausteinPlatzhalterModal.tsx`
- Test: `frontend/src/etb/BausteinPlatzhalterModal.test.tsx` (anlegen oder erweitern)

**Interfaces:** Consumes `ErfassungsModal` (`components/Erfassung.tsx`); Props `offen`, `titel`, `form`, `onErfassen`, `onFertig`, `onAbbrechen`, `erfassenText`. Public Props von `BausteinPlatzhalterModal` bleiben unverändert.

- [x] **Step 1: Failing tests:** „Maske schließt nicht“, „Kreuz mit Platzhalterwert fragt nach“, „Einsetzen liefert die substituierten Felder“ (Baustein mit Platzhalter `{ort}`, Eingabe „Nord“ → `onEinsetzen` mit „Nord“ im Text), „Baustein ohne Platzhalter setzt sofort ein, ohne Dialog“.
- [x] **Step 2:** → FAIL (die ersten beiden).
- [x] **Step 3: Implement.** `ErfassungsModal` mit `titel="Baustein einsetzen"`, `erfassenText="Einsetzen"`, `onErfassen={async (w) => onEinsetzen(setzeBausteinEin(...))}`, `onFertig` = nichts weiter (Aufrufer schließt über `baustein=null` nach `onEinsetzen`; prüfen, ob `onFertig` dafür `onAbbrechenAll` braucht — nein, wenn `onEinsetzen` den Baustein zurücksetzt; Test belegt es), `onAbbrechen={onAbbrechenAll}`. Eigener Knopf und `form.resetFields()` beim Öffnen entfallen, soweit die Hülle zurücksetzt; `autoFocus` am ersten Feld bleibt.
- [x] **Step 4:** → PASS, `etb`-Tests grün.
- [x] **Step 5: Commit** `refactor: Baustein einsetzen läuft über die Erfassungshülle (LLH-2010)`.

### Task 5: „In die Lage übernehmen“ auf `ErfassungsModal`

**Files:**
- Modify: `frontend/src/meldungen/LagerelevantModal.tsx`
- Test: `frontend/src/meldungen/LagerelevantModal.test.tsx` (anlegen oder erweitern)

**Interfaces:** Public Props unverändert (`offen`, `meldung`, `senden`, `einsatzId`, `onAbbrechen`, `onUebergeben`, `speicherung`).

- [x] **Step 1: Failing tests:** „vorbelegter Lage-Text allein: Kreuz schließt still“, „geänderter Lage-Text: Kreuz fragt nach“, „Maske schließt nicht“, „Übernehmen ruft onUebergeben mit getrimmtem Text“, „Speicherfehler steht unter ‚Nicht übernommen‘“.
- [x] **Step 2:** → FAIL.
- [x] **Step 3: Implement.** `ErfassungsModal` mit Titel „In die Lage übernehmen“, `erfassenText` = heutiger Primärknopftext, `speicherung`, `speicherFehlerTitel="Nicht übernommen"`, `laeuft={senden}`, `breite={460}`. `onErfassen` ruft `onUebergeben` (bleibt synchron → `async`-Hülle; die Mutation selbst liegt beim Aufrufer, `speicherung` zeigt ihren Fehler). Vorbelegung per `setFieldsValue` beim Öffnen bleibt. Eigener Fehlerblock und Knöpfe entfallen.
- [x] **Step 4:** → PASS, `meldungen`-Tests grün.
- [x] **Step 5: Commit** `refactor: In die Lage übernehmen läuft über die Erfassungshülle (LLH-2010)`.

### Task 6: Maskensperre für Eintreffen und Auswahldialoge

**Files:**
- Modify: `frontend/src/pages/bereitstellungsraum/EintreffenDialog.tsx` (≈:815), `frontend/src/pages/lagekarte/ZeichenWahlDialog.tsx`, `frontend/src/pages/lagekarte/ZeichenHierDialog.tsx`, `frontend/src/planung/PlanungUebernahmeDialog.tsx`
- Test: je Datei ein Test „die Maske schließt nicht“ in der vorhandenen Testdatei (oder neu)

- [x] **Step 1: Failing tests** „die Maske schließt nicht“ (Klick auf `.ant-modal-wrap`, Schließ-Callback 0×) für alle vier; für Eintreffen zusätzlich „im Schritt Suche schließt Escape weiter sofort“.
- [x] **Step 2:** → FAIL.
- [x] **Step 3: Implement.** Je Modal `mask={{ closable: false }}` und `wrapProps={MASKE_HAELT_FOKUS}`; sonst nichts. Bei Eintreffen am Gerät bleibt der Vollbild-Spread unberührt (prüfen, dass er kein eigenes `wrapProps` setzt; sonst zusammenführen).
- [x] **Step 4:** → PASS.
- [x] **Step 5: Commit** `feat: Eintreffen und Auswahldialoge schließen nicht über die Maske (LLH-2010)`.

### Task 7: Wächter `dialogEingabe.guard.test.ts`

**Files:**
- Create: `frontend/src/components/dialogEingabe.guard.test.ts`

**Interfaces:** eigenständig; Dateikopf im Stil von `rueckfrage.guard.test.ts` (Warum, Was geprüft wird, Was er nicht sieht).

- [x] **Step 1: Test schreiben.** `lieseQuellen` wie im Rückfrage-Wächter; je `<Modal` den Block bis zum passenden `</Modal>` (oder `/>`) mit Tiefenzähler über `<Modal`/`</Modal>` ausschneiden. Block gilt als Eingabedialog, wenn er `/<Form[\s>]|<Input[\s.>]|<TextArea|<InputNumber|<Select[\s>]|<Checkbox[\s>]|<Feld[\s>]/` enthält, außer in einem verschachtelten `<Modal`. Er besteht, wenn der Kopf `mask={{ closable: false }}` oder `{...<bezeichner>.modalProps}` trägt. `AUSNAHMEN: Record<string, string>` (Pfad `datei:Titel-Ausschnitt` → Grund). Zweiter Test: jede Ausnahme trifft noch einen Block (keine toten Einträge).
- [x] **Step 2:** Lauf `mise exec -- pnpm -C frontend vitest run src/components/dialogEingabe.guard.test.ts`; jeden roten Treffer einordnen: Bestand aus Task 2–6 muss grün sein; Schlüsselanzeigen mit `readOnly`-Feld, Personensuche, Verbindungsdialog der Skizze u. Ä. als Ausnahme mit Grund aus dem Design-Doc („Außerhalb des Umfangs“). Ein unerwarteter echter Eingabedialog wird nicht in die Ausnahmen gelegt, sondern mit `useVerwerfenSchutz` versorgt (wie Task 2) und gemeldet.
- [x] **Step 3: Mutationsprobe.** `mask={{ closable: false }}` in `ZeichenHierDialog.tsx` vorübergehend entfernen → Wächter rot mit Dateinamen; zurücksetzen → grün. Ergebnis im Commit-Body nennen.
- [x] **Step 4: Commit** `test: Wächter gegen Eingabedialoge mit schließender Maske (LLH-2010)`.

### Task 8: Regel, Design System, Gates

**Files:**
- Modify: `frontend/AGENTS.md` (Abschnitt „Frontend — Erfassungs-Norm“, nach dem LLH-1755-Punkt)
- Ggf. Modify: Design-System-Ausgabe (`pnpm -C frontend design-system`), Anwenderkapitel, die LLH-1755 angefasst hat

- [x] **Step 1: Regel** einfügen (Wortlaut aus dem Design-Doc, „Regeln, die sich ändern“): eigenes `<Modal>` mit gesteuerten Feldern → `useVerwerfenSchutz`; reiner Auswahldialog → nur Maskensperre; Wächter `components/dialogEingabe.guard.test.ts`.
- [x] **Step 2:** `grep -rn "Erfassungs-Norm\|Eingaben verwerfen" frontend/scripts/design-system docs/anwender | head`; trägt die README den Abschnitt, `mise exec -- pnpm -C frontend design-system` und Ergebnis mitcommitten. Anwenderdoku nur, wenn LLH-1755 dort Maske/Rückfrage beschreibt.
- [x] **Step 3: Gates:** `./scripts/check-all.sh --geaendert --ohne-e2e` → alle Schritte grün (Prettier, Lint, Typecheck, Vitest der berührten Suiten).
- [x] **Step 4: Commit** `docs: Erfassungs-Norm nennt den Schutz handgebauter Dialoge (LLH-2010)`.
