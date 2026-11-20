# Stille Zeit- und Zahlkorrekturen sichtbar machen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zeit- und Zahlfelder korrigieren nie still: „gestern/morgen“ bleibt sichtbar, Unlesbares bleibt stehen und sperrt das Senden, Zahlgrenzen sind Prüffehler, die Erinnerung ist mit +30 min vorbelegt.

**Architecture:** Ein Sperr-Baustein (`components/instrument/eingabeSperre.tsx`) gibt per Kontext eine Meldestelle an das Steuerelement und hängt `Feld`/`DatenfeldEingabe` eine Prüfregel an; `ZeitpunktEingabe` meldet dort seinen Grund. Zahlgrenzen kommen aus `components/zahlRegel.ts` statt aus `min`/`max`/`precision` an `InputNumber`; ein Wächter verbietet die drei Props.

**Tech Stack:** React 19, antd 5 (`Form`, `InputNumber`), Vitest + Testing Library, dayjs.

**Spec:** `docs/superpowers/specs/2026-11-20-obmcvm14-stille-korrekturen-sichtbar-design.md`

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Technik englisch (AGENTS.md, LLH-1312); Prosa, Kommentare, Testnamen deutsch.
- Meldungen am Feld: wenige Wörter, kein Satz (`frontend/AGENTS.md`, LFH-1078). Texte: „Höchstens 120 Jahre“, „Mindestens 1“, „Nur ganze Zahlen“, „Höchstens 2 Nachkommastellen“.
- Altwerte: Die Zahlregel prüft nur berührte Felder (Entscheidung 20.11.2026).
- `openspec/` bleibt unverändert; neue Regeln stehen in `frontend/AGENTS.md`.
- Kommandos im Frontend über `mise exec -- pnpm …` (LFH-773).
- Commits enden mit der Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/obmcvm14i5rlxq6a75fvtre1`.

## Review Focus

1. Ein optionales, leeres Zeitfeld mit unlesbarem Text darf nicht `null` senden (es sendet gar nicht) → Test in Task 3.
2. Nach Korrektur einer gesperrten Eingabe verschwindet die Fehlerzeile, und das Senden geht wieder → Test in Task 2.
3. `ZeitraumEingabe`: Sperre bleibt, solange eines der beiden Felder einen Grund meldet → Test in Task 3.
4. Ein Altwert außerhalb der Grenzen sperrt nicht, solange das Feld unberührt ist → Test in Task 1.
5. Ein `InputNumber` mit Grenzen über mehrere Zeilen JSX fällt dem Wächter auf → Mutationsprobe in Task 7.

---

### Task 1: `zahlRegel`

**Files:**
- Create: `frontend/src/components/zahlRegel.ts`
- Test: `frontend/src/components/zahlRegel.test.tsx`

**Interfaces:**
- Produces: `zahlRegel(o: { min?: number; max?: number; ganz?: boolean; stellen?: number; einheit?: string }): FormRule` — Form-Regel in Funktionsform `({ isFieldTouched }) => ({ validator })`. Leer (`null`/`undefined`) → ok. Unberührt (`isFieldTouched(name)` false; Name aus `rule.field`, Punkt-Pfad, Ziffernsegmente als Zahl) → ok. Prüfreihenfolge: ganz → stellen → min → max. Meldungen: `Mindestens ${min}${einheit ? ' ' + einheit : ''}`, `Höchstens ${max}…`, `Nur ganze Zahlen`, `Höchstens ${stellen} Nachkommastellen`.
- Produces: `pruefeZahl(wert: number | null | undefined, o): string | null` — der reine Kern (für Bausteine ohne Formular, Task 6).

- [x] **Step 1: Tests schreiben** — `pruefeZahl(250, { max: 120, einheit: 'Jahre' })` → `'Höchstens 120 Jahre'`; `pruefeZahl(-1, { min: 0 })` → `'Mindestens 0'`; `pruefeZahl(2.5, { ganz: true })` → `'Nur ganze Zahlen'`; `pruefeZahl(7.123, { stellen: 2 })` → `'Höchstens 2 Nachkommastellen'`; `pruefeZahl(7.1, { stellen: 2 })` → `null`; `pruefeZahl(null, { min: 1 })` → `null`. Formular-Test: `Form` mit `initialValues={{ alter: 130 }}`, `Feld name="alter" rules={[zahlRegel({ max: 120, einheit: 'Jahre' })]}` + `InputNumber`; Absenden ohne Berühren → `onFinish` gerufen; 250 tippen, Absenden → `onFinish` nicht gerufen, „Höchstens 120 Jahre“ sichtbar, Feld zeigt „250“.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/components/zahlRegel.test.tsx` → FAIL (Modul fehlt).
- [x] **Step 3:** `zahlRegel` und `pruefeZahl` implementieren. Nachkommastellen über Textform der Zahl (`String(wert)`, Exponentialform beachten), nicht über Fließkomma-Arithmetik.
- [x] **Step 4:** Test → PASS.
- [x] **Step 5:** Commit `feat(erfassung): Zahlregel prüft statt zu kappen`.

### Task 2: Sperr-Baustein in `Feld` und `DatenfeldEingabe`

**Files:**
- Create: `frontend/src/components/instrument/eingabeSperre.tsx`
- Modify: `frontend/src/components/instrument/Feld.tsx`, `frontend/src/components/instrument/DatenfeldEingabe.tsx`, `frontend/src/components/instrument/index.ts` (Export)
- Test: `frontend/src/components/instrument/eingabeSperre.test.tsx`

**Interfaces:**
- Produces: `useEingabeSperre(): (grund: string | null) => void` — für Steuerelemente; je Instanz eine Quelle (`useId`), räumt beim Aushängen ab; ohne Stelle ein No-op.
- Produces: `useSperrStelle(name: NamePath | undefined): { Stelle: (p: { children: ReactNode }) => ReactElement; regel: FormRule }` — für `Feld`/`DatenfeldEingabe`. Die Regel lehnt mit dem ersten gemeldeten Grund ab. Fällt der letzte Grund weg und hat das Feld Fehler, ruft die Stelle `form.validateFields([name])` (Fehler geschluckt).
- `Feld`: `<Stelle><Form.Item … rules={[...(rules ?? []), regel]} /></Stelle>` — der Provider steht **außen**, damit `Form.Item` sein Kind weiter klonen kann. Ohne `name` keine Regel, kein Provider.
- `DatenfeldEingabe`: dasselbe um sein `Form.Item`.

- [x] **Step 1: Tests schreiben** — Testkomponente `Sperrer` (ruft `useEingabeSperre()` mit einem Grund aus Props). `Form` + `Feld name="x"` + `Sperrer grund="nicht lesbar"`: Absenden → `onFinish` nicht gerufen, „nicht lesbar“ in der Fehlerzeile. Grund auf `null` umgestellt → Fehlerzeile weg, Absenden → `onFinish` gerufen. Zwei Sperrer im selben Feld, einer räumt → weiter gesperrt. Sperrer ohne `Feld` → kein Fehler, kein Wurf. Gleicher Fall in `DatenfeldEingabe`.
- [x] **Step 2:** `… vitest run src/components/instrument/eingabeSperre.test.tsx` → FAIL.
- [x] **Step 3:** Baustein implementieren, in `Feld` und `DatenfeldEingabe` einhängen.
- [x] **Step 4:** Test → PASS; dazu `… vitest run src/components/instrument` → PASS (Feld-/Datenfeld-Tests unverändert grün).
- [x] **Step 5:** Commit `feat(erfassung): Feld sperrt das Senden bei gemeldetem Eingabegrund`.

### Task 3: `ZeitpunktEingabe` — Hinweis bleibt, Unlesbares bleibt stehen und sperrt

**Files:**
- Modify: `frontend/src/anzeige/ZeitpunktEingabe.tsx`
- Test: `frontend/src/anzeige/ZeitpunktEingabe.test.tsx`

**Interfaces:**
- Consumes: `useEingabeSperre` (Task 2).
- Verhalten:
  - Nicht tippend, kein Grund, nicht `nurTag`: Suffix `gestern`/`morgen`, wenn `tagInZone(wert)` Vortag/Folgetag von `heuteInZone(zone, serverJetzt())` ist (gleiche Darstellung wie die Deutung, `monoKlein`, gedämpft).
  - `onBlur` mit unlesbarem Text: Text bleibt (`setText` nicht leeren), `setDiscarded(grund)`, kein `onChange`.
  - Sperre melden: `meldeSperre(grund)` immer dann, wenn das Feld einen Grund zeigt, der nicht mehr Tippen ist, also nach dem Verlassen (`discarded`), und `null`, wenn er weicht (Übernahme, Escape, Wert von außen). Während des Tippens wird nichts gemeldet.
  - Escape mit stehendem Text: Text weg, Grund weg, geltender Wert sichtbar (bestehender Zweig).
  - Doppelten Grund vermeiden: `Form.Item.useStatus()`; zeigt es `status === 'error'` und `errors` enthält den Grund, steht kein Grund im Suffix.

- [x] **Step 1: Tests umstellen und ergänzen** —
  - Test „Unlesbares und Verlassen: geltender Wert zurück…“ (Zeile ~275) wird zu: „Unlesbares und Verlassen: Text bleibt stehen, Grund bleibt, Formular sendet nicht“ (Erwartung: Feld zeigt „morgen“, „nicht lesbar“ sichtbar, `onFinish` nicht gerufen).
  - Neu: Fristfeld, Uhr 17:59 (Serveruhr gestellt wie in den bestehenden Tests), „1700“ + Enter → Feld zeigt DTG des Folgetags **und** „morgen“.
  - Neu: optionales Feld ohne Wert (`value` null), „xyz“ getippt, verlassen, Absenden → `onFinish` nicht gerufen (nicht mit `null`).
  - Neu: danach „1430“ getippt + Enter → Fehlerzeile weg, Absenden sendet.
  - Neu: `ZeitraumEingabe` in `Feld`, Beginn unlesbar, Ende lesbar → gesperrt; Beginn korrigiert → frei.
  - Neu: nach Absenden steht „nicht lesbar“ genau einmal im Dokument.
  - Bestehender LLH-1866-Test (`onDiscard`) bleibt grün.
- [x] **Step 2:** `… vitest run src/anzeige/ZeitpunktEingabe.test.tsx` → neue Fälle FAIL.
- [x] **Step 3:** Verhalten implementieren; Kopfkommentar („Verlassen zeigt wieder den geltenden Wert“, D3) auf die neue Regel umschreiben.
- [x] **Step 4:** `… vitest run src/anzeige src/etb` → PASS (ETB-Sperre LLH-1866 unverändert).
- [x] **Step 5:** Commit `fix(zeiteingabe): Unlesbares bleibt stehen und sperrt, gestern/morgen bleibt sichtbar`.

### Task 4: `InlineAngabe` als Sperrstelle

**Files:**
- Modify: `frontend/src/components/InlineAngabe.tsx`
- Test: `frontend/src/components/InlineAngabe.test.tsx`

**Interfaces:**
- Consumes: Sperr-Kontext aus Task 2. `InlineAngabe` stellt einen eigenen Provider (gleicher Kontext, ohne `Form`): Solange ein Grund gemeldet ist, sendet `abschicken()` nicht und zeigt den Grund über `FeldFehler` (wie `pruefGrund`). Dafür exportiert `eingabeSperre.tsx` zusätzlich `SperrKontextProvider`/`useSperrSammler(): { Stelle; grund: string | null }` (Name nach Wahl, in diesem Task festlegen und exportieren).

- [x] **Step 1: Test** — `InlineAngabe` mit `ZeitpunktEingabe` (wie `pages/EinsatzdatenPage.tsx:271`): „morgen“ tippen, Enter bzw. Verlassen → `onSpeichern` nicht gerufen, Zeile bleibt offen, Text steht.
- [x] **Step 2:** FAIL.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** `… vitest run src/components/InlineAngabe.test.tsx src/pages` → PASS.
- [x] **Step 5:** Commit `fix(zeiteingabe): Inline-Angabe speichert keine unlesbare Zeit`.

### Task 5: Erinnerung mit +30 min

**Files:**
- Create: `frontend/src/anzeige/zeitSchnellwahl.ts` — Konstante `VORGABE_FRIST_MINUTEN = 30` (dort liegt die geteilte Schnellwahl); `etb/WiedervorlageModal.tsx` nimmt sie statt `VORGABE_MINUTEN`.
- Modify: `frontend/src/erinnerung/ErinnerungFormular.tsx`, `frontend/src/etb/WiedervorlageModal.tsx`
- Test: `frontend/src/erinnerung/ErinnerungFormular.test.tsx` (anlegen, falls nicht vorhanden)

- [x] **Step 1: Test** — Serveruhr gestellt; Feld „Fällig“ zeigt DTG von jetzt + 30 min. „morgen“ in „Fällig“ getippt, „Anlegen“ geklickt → `onAnlegen` nicht gerufen. Alter Intervall-Fall: 20000 → „Höchstens 10080 Min“ über `zahlRegel({ max: INTERVALL_MAX_MINUTEN, einheit: 'Min' })` (bisherigen Wortlaut „(7 Tage)“ nicht behalten: Einheit-Form der Regel).
- [x] **Step 2:** FAIL.
- [x] **Step 3:** `initialValues.faellig = serverJetzt().add(VORGABE_FRIST_MINUTEN, 'minute')`; Intervall-Regel auf `zahlRegel`, `min={1}` an `InputNumber` → `zahlRegel({ min: 1, max: …, ganz: true, einheit: 'Min' })`.
- [x] **Step 4:** `… vitest run src/erinnerung src/etb` → PASS.
- [x] **Step 5:** Commit `fix(erinnerung): Fälligkeit mit +30 min vorbelegt`.

### Task 6: Zahl-Bausteine ohne Kappen

**Files:**
- Modify: `frontend/src/components/MengenFeld.tsx`, `frontend/src/components/DezimalFeld.tsx`, `frontend/src/components/RadiusEingabe.tsx`, `frontend/src/anzeige/StaerkeEingabe.tsx`, `frontend/src/kraefte/QualiSollFeld.tsx` und alle Aufrufer (16× `<MengenFeld`, Aufrufer von `DezimalFeld`, `RadiusEingabe`, `QualiSollFeld`)
- Test: je Baustein die vorhandene `*.test.tsx` erweitern

**Interfaces:**
- `MengenFeldProps` und `DezimalFeldProps` lassen zusätzlich `'min' | 'max'` weg (Typfehler statt Wächter). Exporte: `mengenRegel(o?: { max?: number }) = zahlRegel({ min: 1, ganz: true, ...o })`, `dezimalRegel(stellen: number, o?: { min?: number; max?: number })`. Jeder Aufrufer hängt die Regel an sein `Feld`/`DatenfeldEingabe`; bisherige `min`/`max`-Props am Aufrufer wandern in die Regel.
- `DezimalFeld`: kein `precision`; `formatter={(v, { userTyping, input }) => userTyping ? input : formatMindestStellen(v, stellen)}` (zeigt mindestens `stellen` Stellen mit Komma, kürzt nie); `step` bleibt.
- `RadiusEingabe`: exportiert `radiusRegel = zahlRegel({ min: 1, max: KREIS_RADIUS_M_MAX, ganz: true, einheit: 'm' })`; ohne `Form.Item` (Kreis-Band der Lagekarte) prüft die Eingabe selbst über `pruefeZahl`: Fehlerstatus und Meldung am Feld, `onChange` nur mit gültigem Wert.
- `StaerkeEingabe`: kein `min`; ein negativer Wert zeigt `status="error"` mit „Mindestens 0“ und wird nicht gemeldet; exportiert `staerkeRegel` (lehnt negative Teile ab) für Aufrufer mit `Feld`.
- `QualiSollFeld`: Anzahl ohne `min`/`max`/`precision`; exportiert `qualiSollRegel` (jede Zeile `pruefeZahl(anzahl, { min: 1, max: QUALI_SOLL_ANZAHL_MAX, ganz: true })`, erste Meldung gewinnt; Zeilenzahl > `QUALI_SOLL_MAX` → Meldung).

- [x] **Step 1: Tests** — `MengenFeld` in `Feld` mit `mengenRegel()`: „0“ → „Mindestens 1“, „2,5“/„2.5“ → „Nur ganze Zahlen“, Feld zeigt weiter die Eingabe. `DezimalFeld stellen={2}`: „7,123“ verlassen → Feld zeigt „7,123“, Regel meldet „Höchstens 2 Nachkommastellen“; „7,1“ verlassen → zeigt „7,10“. `RadiusEingabe` ohne Formular: „99999“ → Meldung, `onChange` nicht mit 99999. `StaerkeEingabe`: „-1“ → „Mindestens 0“, kein `onChange` mit negativem Teil. `QualiSollFeld` mit `qualiSollRegel`: Anzahl 0 → „Mindestens 1“.
- [x] **Step 2:** FAIL.
- [x] **Step 3:** Bausteine und alle Aufrufer umstellen; `pnpm exec tsc --noEmit` findet vergessene `min`/`max` an `MengenFeld`/`DezimalFeld`.
- [x] **Step 4:** `mise exec -- pnpm -C frontend exec tsc --noEmit` → keine Fehler; `… vitest run src/components src/anzeige src/kraefte src/pages/lagekarte src/stammdaten src/betreuung src/verpflegung` → PASS.
- [x] **Step 5:** Commit `fix(erfassung): Zahl-Bausteine prüfen statt zu kappen`.

### Task 7: Übrige `InputNumber` und Wächter

**Files:**
- Create: `frontend/src/components/zahlfeld.guard.test.ts`
- Modify: alle verbliebenen Fundstellen von `<InputNumber` mit `min=`, `max=` oder `precision=` (Stand Entwurf: `stammdaten/StatusKatalogTab.tsx`, `stammdaten/QualifikationenTab.tsx`, `stammdaten/PersonalStatusTab.tsx`, `stammdaten/EinheitTypenTab.tsx`, `stammdaten/FahrzeugDetailPage.tsx`, `stammdaten/EtbBausteinFormModal.tsx`, `verpflegung/VerpflegungDialoge.tsx`, `personen/LeichterFallModal.tsx`, `personen/AufnahmeFelder.tsx`, `betreuung/BezirkStammdaten.tsx`, `betreuung/BetreuungDialoge.tsx`, `karten/OnlineQuelleFormModal.tsx`, `pages/einstellungen/EinsatzDefaults.tsx`, `pages/einstellungen/KategorieVorgabenPaneel.tsx`, `pages/BetreuungsstelleDetailPage.tsx`, `pages/uhs/UhsAngaben.tsx`, dazu mehrzeilige Treffer, die der Wächter findet)

**Interfaces:**
- Wächter: Glob `/src/**/*.tsx` (`?raw`, eager, wie `anzeige/zahl.guard.test.ts`), ohne Tests. Für jedes `<InputNumber` bis zum schließenden `>` des Öffnungstags (über Zeilen, geschweifte Klammern mitzählen) darf kein Attribut `min`, `max` oder `precision` stehen. Keine Ausnahmeliste. Meldung nennt Datei und Zeile.
- Alter: `zahlRegel({ min: 0, max: 120, ganz: true, einheit: 'Jahre' })` an `alter_geschaetzt` in Aufnahme und Leichter Fall.

- [x] **Step 1:** Wächter schreiben → `… vitest run src/components/zahlfeld.guard.test.ts` → FAIL mit Liste der Fundstellen.
- [x] **Step 2:** Jede Fundstelle umstellen: Grenzen in `rules` des umgebenden `Feld`/`DatenfeldEingabe` per `zahlRegel` (`precision={0}` → `ganz: true`). Liegt eine Fundstelle in keinem `Form.Item`: wie `RadiusEingabe` über `pruefeZahl` selbst prüfen.
- [x] **Step 3:** Test für das Alter in `personen/AufnahmeFelder` (bestehende Testdatei oder neu): 250 → „Höchstens 120 Jahre“, kein Senden, Feld zeigt 250.
- [x] **Step 4:** Wächter → PASS. Mutationsprobe: in einer Datei mehrzeilig `max={5}` an ein `InputNumber` setzen → Wächter FAIL, zurücknehmen.
- [x] **Step 5:** `… vitest run` über die geänderten Verzeichnisse und `tsc --noEmit` → PASS.
- [x] **Step 6:** Commit `fix(erfassung): Zahlenfelder ohne min/max/precision, Wächter`.

### Task 8: Regeln, Doku, Gates

**Files:**
- Modify: `frontend/AGENTS.md` (Abschnitt „Zeiteingabe ist ein Textfeld“: neue Regel zu Unlesbarem samt Sperre über `Feld`/`DatenfeldEingabe`/`InlineAngabe`, löst die Spec-Anforderung „Unlesbare Eingabe wird nicht übernommen“ ab, soweit sie „wieder den geltenden Wert zeigen“ verlangt, Verweis auf das Design-Doc; Abschnitt der Erfassungs-Norm: Regel „Zahlenfelder kappen und runden nie“ mit `zahlRegel` und Wächter `components/zahlfeld.guard.test.ts`)
- Modify: `docs/anwender/…` nur, wenn ein Kapitel das alte Verhalten beschreibt (`grep -rn "geltenden Wert\|wieder den" docs/anwender`); Bilder nicht neu erzeugen, außer der Wächter der Anwenderdoku verlangt es.

- [x] **Step 1:** Regeln eintragen; `grep -rn "zeigt wieder den geltenden\|Verlassen zeigt wieder" frontend/src docs` → Verweise nachziehen.
- [x] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [x] **Step 3:** Commit `docs(frontend): Regeln für Unlesbares und Zahlenfelder`.
