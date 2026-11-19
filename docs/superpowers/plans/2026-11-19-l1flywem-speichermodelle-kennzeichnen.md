# Speichermodelle kennzeichnen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ungespeichertes sichtbar machen: Punkt am Etikett geänderter Felder, „Speichern“ erst
bei Änderung aktiv mit Stand daneben, Hinweis am offenen, geänderten Inline-Feld.

**Architecture:** Ein Kontext `aenderungsstand` innerhalb jedes `<Form>` vergleicht die
Feldwerte (`Form.useWatch`) mit einem Ausgangsstand; `Feld`, `DatenfeldEingabe` und der neue
`SpeicherKnopf` lesen ihn. `InlineAngabe` bekommt Hinweis, Achtungskante und das stille Schließen
eines unveränderten Felds beim Klick daneben.

**Tech Stack:** React 19, antd 5, Vitest + Testing Library, Playwright (Bilder).

**Spec:** `docs/superpowers/specs/2026-11-19-l1flywem-speichermodelle-kennzeichnen-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/l1flywemzy9t64kcea3dnrn0

## Global Constraints

- Wortlaute exakt: „Keine Änderungen“, „1 Änderung“, „{n} Änderungen“, „Nicht gespeichert — Enter
  speichert, Esc verwirft“, mehrzeilig „Nicht gespeichert — Strg+Enter speichert, Esc verwirft“,
  gesperrt nur „Nicht gespeichert“; Punkt „•“ (`aria-hidden`) plus verborgenes „(geändert)“
  (`NUR_VORLESER` aus `components/instrument/Status.tsx`).
- Keine neue `fontSize`-Zahl (`schriftgroesse.guard`), Abstände nur aus dem Raster
  (`abstandsraster.guard`, `var(--lfh-luft-*)` bzw. antd-Token), Text über `Textstufe`.
- Gleichheit für den Stand: `undefined` ≙ `null` ≙ `''`; sonst Inhalt wie `gleich` in
  `BearbeitbaresPaneel.tsx:116` (JSON, `dayjs` über `toJSON`). Das Patch-Verhalten von
  `BearbeitbaresPaneel` (`bearbeitetePatch`) bleibt unverändert.
- Kein Blur-Speichern; `BemerkungZelle` und der Abschnitte-Dialog bleiben unberührt.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LLH-1312).
- Gate vor dem PR: `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Review Focus

1. Speichern scheitert (Server 4xx/5xx): Punkte und Stand bleiben, Knopf bleibt aktiv → Test in
   Task 1 (`merke` nur bei Erfolg) und Task 3 (Paneel-Fehler).
2. Weitertippen während des Speicherns: das danach geänderte Feld behält den Punkt → Test in
   Task 1 (`merke` mit den gesendeten Werten, nicht den aktuellen).
3. Datensatzwechsel auf derselben Route (`key={id}`, Personal-Detail): kein Punkt aus dem vorigen
   Datensatz → Test in Task 4.
4. Optionales Feld geleert, das vorher nie gesetzt war (`undefined` → `''`): kein Punkt → Test in
   Task 1.
5. Klick in die Auswahlliste / den Kalender eines offenen Inline-Felds ohne Änderung: Feld bleibt
   offen → Test in Task 5.

---

### Task 1: Baustein `aenderungsstand`

**Files:**
- Create: `frontend/src/components/aenderungsstand.tsx`
- Test: `frontend/src/components/aenderungsstand.test.tsx`

**Interfaces:**
- Produces:
  - `AenderungsstandProvider({ ausgangswerte, children }: { ausgangswerte: object | undefined; children: ReactNode })` — innerhalb eines antd `<Form>`, holt die Instanz per `Form.useFormInstance()`.
  - `useFeldGeaendert(name: NamePath | undefined): boolean` — `false` ohne Provider oder ohne `name`.
  - `useAenderungsanzahl(): number | null` — `null` ohne Provider.
  - `useAenderungsstandMerke(): (werte: object) => void` — No-op ohne Provider; übernimmt `werte` als neuen Ausgangsstand.
  - `gleichFuerStand(a: unknown, b: unknown): boolean` (exportiert für Tests).

- [ ] **Step 1: Failing tests** in `aenderungsstand.test.tsx` (kleines Testformular mit `Form`, `Feld`-freiem `Form.Item` + `Input`, Testkomponente zeigt `useFeldGeaendert('name')` und `useAenderungsanzahl()`):
  - `'zeigt ein Feld als geändert, sobald der Wert vom Ausgangsstand abweicht'` → nach Tippen `true`, Anzahl `1`.
  - `'nimmt die Markierung zurück, wenn der Wert zurückgeändert wird'` → `false`, Anzahl `0`.
  - `'behandelt undefined, null und Leertext als gleich'` → `gleichFuerStand(undefined, '')`, `gleichFuerStand(null, '')` sind `true`; `gleichFuerStand('a', '')` `false`; `gleichFuerStand(['a'], ['a'])` `true`.
  - `'merke übernimmt die gesendeten Werte als neuen Ausgangsstand'` → nach `merke({ name: 'B' })` bei Wert `B` Anzahl `0`.
  - `'ein nach dem Absenden geändertes Feld bleibt geändert'` → Werte `{name:'B', ort:'X'}` gesendet, danach `ort` auf `Y` getippt, `merke({name:'B', ort:'X'})` → `ort` geändert, Anzahl `1`.
  - `'ohne Provider meldet nichts'` → `useFeldGeaendert` `false`, `useAenderungsanzahl` `null`.

- [ ] **Step 2: Run** `mise exec -- pnpm vitest run src/components/aenderungsstand.test.tsx` — Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implement.** Provider hält den Ausgangsstand in State (beim ersten nicht-`undefined` `ausgangswerte` gesetzt), beobachtet `Form.useWatch([], { form, preserve: true })` und rechnet die geänderten Namen über die Vereinigung der Schlüssel beider Objekte mit `gleichFuerStand`. Zwei Kontexte (Stand-Liste und `merke`), damit ein Feld nur bei seinem eigenen Wechsel neu rendert (`useFeldGeaendert` vergleicht per `useWatch(name)` gegen den Ausgangswert dieses Namens). `NamePath` als Array wird über den ersten Teil auf den obersten Namen abgebildet.

- [ ] **Step 4: Run** wie Step 2 — Expected: PASS.

- [ ] **Step 5: Commit** `feat(frontend): Änderungsstand eines Formulars (LLH-1829)`.

### Task 2: Punkt am Etikett und `SpeicherKnopf`

**Files:**
- Modify: `frontend/src/components/instrument/Feld.tsx`, `frontend/src/components/instrument/DatenfeldEingabe.tsx`
- Create: `frontend/src/components/SpeicherKnopf.tsx`
- Test: `frontend/src/components/instrument/Feld.test.tsx`, `frontend/src/components/instrument/DatenfeldEingabe.test.tsx`, `frontend/src/components/SpeicherKnopf.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`useFeldGeaendert`, `useAenderungsanzahl`).
- Produces: `SpeicherKnopf({ loading, disabled }: { loading?: boolean; disabled?: boolean })` — rendert `Button type="primary" htmlType="submit"` „Speichern“ und den Stand; exportiert `aenderungsText(n: number): string`.
- Produces: `GeaendertPunkt({ name }: { name: NamePath | undefined })` in `components/instrument/GeaendertPunkt.tsx` (Export über `instrument/index.ts`), von `Feld` und `DatenfeldEingabe` genutzt.

- [ ] **Step 1: Failing tests:**
  - Feld: `'trägt am Etikett einen Punkt, wenn das Feld geändert ist'` → nach Tippen im Provider: `getByText('•')` vorhanden mit `aria-hidden="true"`, `getByLabelText(/\(geändert\)/)` findet die Eingabe; zurückgeändert beides weg. `'ohne Provider kein Punkt'`.
  - DatenfeldEingabe: dieselben zwei Fälle am `<label>` der Zelle.
  - SpeicherKnopf: `aenderungsText(0) === 'Keine Änderungen'`, `aenderungsText(1) === '1 Änderung'`, `aenderungsText(3) === '3 Änderungen'`; `'ohne Änderung gesperrt mit sichtbarem Grund'` → Knopf `disabled`, `aria-describedby` zeigt auf das Element mit „Keine Änderungen“; `'mit Änderung aktiv'`; `'ohne Provider aktiv und ohne Stand'` (Rückfall für nicht umgestellte Aufrufer); `'Form disabled: kein Stand'`.

- [ ] **Step 2: Run** `mise exec -- pnpm vitest run src/components/instrument/Feld.test.tsx src/components/instrument/DatenfeldEingabe.test.tsx src/components/SpeicherKnopf.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.** `Feld` setzt bei geändertem Feld das `label` zu `<>{label}<GeaendertPunkt name={name} /></>` (nur wenn `label` gesetzt). `GeaendertPunkt`: `<span aria-hidden>{' •'}</span><span style={NUR_VORLESER}> (geändert)</span>`, Farbe `rollen.bedienText`. Stand im `SpeicherKnopf` als `Textstufe stufe="textKlein" ton="text2"` mit `aria-live="polite"` und `useId`-Kennung; Knopf und Stand nebeneinander, umbrechend (`flex-wrap`, Abstand `var(--lfh-luft-2)`). `disabled` des Formulars über `Form`'s `DisabledContext` (antd `ConfigProvider`-`DisabledContext`) lesen; dann Stand weglassen.

- [ ] **Step 4: Run** wie Step 2 — Expected: PASS.

- [ ] **Step 5: Commit** `feat(frontend): Punkt am geänderten Feld und SpeicherKnopf (LLH-1829)`.

### Task 3: `BearbeitbaresPaneel` mit Stand

**Files:**
- Modify: `frontend/src/components/instrument/BearbeitbaresPaneel.tsx`
- Test: `frontend/src/components/instrument/BearbeitbaresPaneel.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`AenderungsstandProvider` mit `ausgangswerte = sitzung?.werte`), Task 2 (`SpeicherKnopf`).

- [ ] **Step 1: Failing tests:** `'Speichern ist ohne Änderung gesperrt und nennt „Keine Änderungen“'`; `'ein geändertes Feld trägt den Punkt'`; `'Enter ohne Änderung schließt das Paneel'` (Fokus im ersten Feld, `{Enter}` → Lesezustand, `onSpeichern` nicht gerufen); `'nach gescheitertem Speichern bleiben Punkt und „1 Änderung“'`.

- [ ] **Step 2: Run** `mise exec -- pnpm vitest run src/components/instrument/BearbeitbaresPaneel.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.** Provider im `<Form>` um Raster und Fuß; in `knoepfe` den Speichern-Button durch `<SpeicherKnopf loading={laeuft} />` ersetzen, „Abbrechen“ bleibt daneben. Enter-Weg: im bestehenden `onTaste` (Raster-`onKeyDown`) bei `e.key === 'Enter'`, Ziel kein `textarea`, nicht `defaultPrevented`, Popup nicht offen (`aria-expanded="true"` am Ziel) und Anzahl `0` → `melde('zu'); schliesse()`. Anzahl über eine kleine Kindkomponente oder `useAenderungsanzahl` in einem Teil innerhalb des Providers lesen.

- [ ] **Step 4: Run** wie Step 2 — Expected: PASS, bestehende Tests der Datei ebenfalls grün.

- [ ] **Step 5: Commit** `feat(frontend): BearbeitbaresPaneel zeigt Änderungsstand (LLH-1829)`.

### Task 4: 13 Formularseiten umstellen + Wächter

**Files:**
- Modify: `stammdaten/{PersonalDetailPage,OrganisationTab,FahrzeugDetailPage,EinheitVorlageDetailPage}.tsx`, `betreuung/BezirkStammdaten.tsx`, `pages/einstellungen/{EinsatzAllgemein,EinsatzDefaults,AnzeigeEinstellungen,EinsatzAufbewahrung,EinsatzVerhalten}.tsx`, `pages/{TiereDetailPage,BetreuungsstelleDetailPage,SchaedenDetailPage}.tsx` (alle unter `frontend/src/`)
- Create: `frontend/src/components/speicherKnopf.guard.test.ts`
- Test: bestehende Seitentests, je Seitengruppe ein neuer Fall (siehe Step 1)

**Interfaces:**
- Consumes: Task 1 (`AenderungsstandProvider`, `useAenderungsstandMerke`), Task 2 (`SpeicherKnopf`).

- [ ] **Step 1: Failing tests:**
  - Wächter `speicherKnopf.guard.test.ts` (Muster `feld.guard.test.ts`, `quellwurzel`, `ohneKommentare`): jede `.tsx` unter `src/` außer Tests, die `useSpeicherLeiste` aufruft, enthält `SpeicherKnopf` und `AenderungsstandProvider`; `BearbeitbaresPaneel.tsx` zählt mit.
  - `EinsatzAllgemein.test.tsx`: `'Speichern erst nach einer Änderung, danach wieder „Keine Änderungen“'` (ändern → „1 Änderung“ → speichern erfolgreich → „Keine Änderungen“).
  - `PersonalDetailPage.test.tsx`: `'nach dem Wechsel auf einen anderen Datensatz kein Punkt'` (Feld ändern, Route-Parameter wechseln → kein „•“, „Keine Änderungen“).
  - `TiereDetailPage.test.tsx` (Bearbeiten-Modus mit Abbrechen): `'Enter ohne Änderung schließt den Bearbeiten-Modus'`.

- [ ] **Step 2: Run** `mise exec -- pnpm vitest run src/components/speicherKnopf.guard.test.ts src/pages/einstellungen src/stammdaten src/pages/TiereDetailPage.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** je Seite: `<AenderungsstandProvider ausgangswerte={<die initialValues der Seite>}>` als erstes Kind von `<Form>`, das die Felder und die Leiste umschließt; Knopf → `<SpeicherKnopf loading={…} />`; im Erfolgszweig neben `schutz.gespeichert(fassung)` ein `merke(werte)` (Hook in einer Kindkomponente oder per Ref, da `merke` aus dem Kontext im `<Form>` kommt — Muster: kleine `SpeichernMerken`-Brücke, die `merke` in einen Ref der Seite legt). Bearbeiten-Modus-Seiten (Tiere, Schäden, Bezirk, Betreuungsstelle): Ausgangsstand = Werte der offenen Sitzung; Enter ohne Änderung schließt wie in Task 3 (Taste am `<form>`). Seiten ohne Leiste bleiben unberührt.

- [ ] **Step 4: Run** wie Step 2, dann `mise exec -- pnpm vitest run` — Expected: alles PASS.

- [ ] **Step 5: Commit** `feat(frontend): Formularseiten zeigen Änderungsstand (LLH-1829)`.

### Task 5: Offenes Inline-Feld kennzeichnen

**Files:**
- Modify: `frontend/src/components/InlineAngabe.tsx`
- Test: `frontend/src/components/InlineAngabe.test.tsx`

**Interfaces:**
- Consumes: vorhandene Werte `entwurfGeaendert`, `isGesperrt`, `schreibschutz`, `mehrzeilig`, `schliessen` in `InlineAngabe`.

- [ ] **Step 1: Failing tests:**
  - `'zeigt nach der ersten Änderung „Nicht gespeichert — Enter speichert, Esc verwirft“'` (`role="status"`), vorher nicht.
  - `'mehrzeilig nennt Strg+Enter'`.
  - `'gesperrt mit Entwurf nennt nur „Nicht gespeichert“'`.
  - `'Klick daneben schließt ein unverändertes Feld still'` (`pointerDown` auf `document.body` → Eingabe weg, kein `onSpeichern`).
  - `'Klick daneben lässt ein geändertes Feld offen'`.
  - `'Klick in die geöffnete Auswahlliste zählt als innen'` (Select-Eingabe, Liste öffnen, `pointerDown` auf eine Option im Portal → Feld bleibt offen).
  - `'schwebend: Klick daneben schließt das unveränderte Popover'`.

- [ ] **Step 2: Run** `mise exec -- pnpm vitest run src/components/InlineAngabe.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.** Hinweis als `div role="status"` in `rollen.achtungText`, gebaut wie der bestehende „Inzwischen geändert“-Hinweis, unter `SpeicherFehler`, nicht bei `schreibschutz`. Kante: `<form>` bekommt bei `entwurfGeaendert` `borderInlineStart: 2px solid rollen.achtung` und `paddingInlineStart: var(--lfh-luft-1)`. Klick daneben: `onPointerDownCapture` am `<form>` setzt `innenRef.current = true` (läuft auch für Portale); ein `pointerdown`-Hörer am `document` (nur solange `bearbeitet`) prüft danach `innenRef`, setzt ihn zurück und ruft bei `!geaendertRef.current` `schliessen()` ohne Fokusrückgabe; der Anker (`anchorRef`) zählt ebenfalls als innen. Kommentarblock „WAS BEWUSST FEHLT“ um den Satz zum stillen Schließen ergänzen.

- [ ] **Step 4: Run** wie Step 2 — Expected: PASS, bestehende Tests grün.

- [ ] **Step 5: Commit** `feat(frontend): offenes Inline-Feld zeigt „Nicht gespeichert“ (LLH-1829)`.

### Task 6: Regel, Design System, Gate, Bilder

**Files:**
- Modify: `frontend/AGENTS.md` (Abschnitte „Formularseiten“ und „Bearbeiten in der Ansicht“; Bausteinliste um `SpeicherKnopf`, `GeaendertPunkt`; Tabelle „Formularseite mit Feldgruppen“ um `SpeicherKnopf`)
- Modify: `frontend/scripts/design-system/previews.tsx` (Karte `SpeicherKnopf`, Nacht und Tag, mit und ohne Änderung), erzeugte Dateien unter `docs/design/design-system/project/`

- [ ] **Step 1:** Regeltext: Spiegelstrich „**Ungespeichertes ist sichtbar** (LLH-1829, Design-Doc oben): geänderte Felder tragen den Punkt über `components/aenderungsstand.tsx`; „Speichern“ nur über `SpeicherKnopf` (gesperrt mit „Keine Änderungen“, sonst „N Änderungen“; Wächter `speicherKnopf.guard.test.ts`); ein offenes, geändertes Inline-Feld zeigt „Nicht gespeichert …“, ein unverändertes schließt beim Klick daneben.“ In „Bearbeiten in der Ansicht“ Punkt 5 um „Enter ohne Änderung schließt“ ergänzen.
- [ ] **Step 2: Run** `mise exec -- pnpm -C frontend design-system` — Expected: erzeugte Dateien aktualisiert, `designSystem.guard.test.ts` grün.
- [ ] **Step 3: Run** `mise exec -- pnpm -C frontend exec prettier --check AGENTS.md` und `./scripts/check-all.sh --geaendert --ohne-e2e` (Wurzel) — Expected: grün.
- [ ] **Step 4:** Bilder per Wegwerf-Spec `frontend/e2e/doku-bilder/zz-l1flywem.bilder.ts` (nicht committen): Einstellungen „Allgemein“ vorher/nachher (ohne Änderung, mit Änderung und Punkt), Paneel im Bearbeiten, offenes Inline-Feld mit Hinweis. Vorher `cargo build` in der Wurzel.
- [ ] **Step 5: Commit** `docs(frontend): Regel „Ungespeichertes ist sichtbar“, Design System (LLH-1829)`.
