# LFH-642 · FMS-Tableau — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Fahrzeuge eines Einsatzes stehen als Kachelraster auf einer Fläche. Jede Kachel zeigt Funkrufname, Status-Chip (S-Code + Wort), „Seit“ und Einheit. Der Status lässt sich per Klick setzen, die Ziffern 0–9 (`fms_anker`) beschleunigen das.

**Architektur:** Das Tableau ist eine **Ansicht der Fahrzeugseite** (`?ansicht=tableau`, apply-then-clean) und kein eigenes Modul. Eine **Sprungmarke** „FMS-Tableau“ unter Kräfte & Mittel führt dorthin (Muster LFH-620). Endpunkte und Live-Event hängen am Modulschlüssel `fahrzeuge`. Ein eigener Schlüssel wäre getrennt schaltbar und endete in 403 ohne Live-Updates. Das Backend bleibt unverändert.

Es gibt nur **einen Mutationsweg**, die bestehende `statusMutation` der `FahrzeugePage`. Klick und Ziffer laufen beide über `statusBedienungVon(ef).onWaehlen`.

**Tech Stack:** React 19, antd 6, TanStack Query, Vitest + RTL + MSW, Playwright.

**Entscheidungen des Auftraggebers (23.09.2026):**

- **Einstieg:** Sprungmarke plus Ansicht.
- **Gliederung:** Abschnitt → Einheit.
- **Form:** Kachel-Raster.

## Global Constraints

- **Kein neuer Modulschlüssel, keine Backend-Änderung.** `fms_anker` kommt clientseitig aus dem Katalog (`GET /api/fahrzeug-status`).
- **Ton nur aus der Kategorie** (`fahrzeugStatus` in `kraefte/meldebildRaster.ts`), nie `status_farbe` als Fläche.
- **Einziges Bedienziel je Kachel ist `StatusWahl`** (antd-`Button`, erbt `controlHeight`). Die Kachel selbst ist nicht klickbar, und es gibt kein punktuelles `size`.
- **Reihenfolge stabil:** Abschnitt, dann Einheit, dann Funkrufname. **Nie nach Status sortieren** (Kriterium 12).
- **`fms_anker` ist nullable und nicht eindeutig.** Nur ein eindeutig belegter Anker setzt einen Status. Doppelt belegt oder nicht belegt heißt: kein Statuswechsel, dafür ein Hinweis.
- **Ziffern wirken nur** auf die Kachel, in der der Fokus steht. Sie wirken nicht in Eingabefeldern, nicht mit Strg/⌘/Alt, nicht ohne Schreibrecht und nicht während eine Mutation läuft.
- **Einheiten hängen am Modul `einheiten`.** Scheitert der Abruf, zeigt das Tableau die Fahrzeuge ungegliedert mit einem Hinweis und keinen Fehlerzustand.
- **Deutsche Texte mit echten Umlauten.** Bezeichner bleiben ASCII.
- **Pfade nur über `routing/deeplinks.ts`.** Enum-Werte der URL laufen über einen exhaustiven `Record`.

## Review Focus

1. **Doppelter Anker:** Zwei Katalogeinträge teilen sich Ziffer 3. Die Taste 3 setzt dann nichts und meldet „mehrfach belegt“. Test in Task 2 und 4.
2. **Ziffer im Suchfeld/Menü:** Eine „4“ in einem Eingabefeld oder im offenen Statusmenü (Portal) setzt keinen Status. Test in Task 4.
3. **Neues Fahrzeug per Live-Event:** Während der Fokus im Tableau steht, rutscht keine Kachel. Das neue Fahrzeug wartet hinter dem Sammelbanner. Test in Task 4.
4. **Einheiten-403:** Das Tableau bleibt bedienbar, zeigt eine ungegliederte Gruppe und einen Hinweis. Test in Task 5.
5. **Optimistisches Fenster:** Der Chip zeigt schon den neuen Status, „Seit“ aber noch die alte Zeit. Solange die Mutation läuft, steht deshalb „…“ statt einer erfundenen Zeit. Test in Task 4.

---

### Task 1: Deeplink `ansicht` und Sprungmarke

**Files:** `frontend/src/routing/deeplinks.ts` (+ Test), `frontend/src/einsatz/sprungmarken.ts` (+ Test)

**Produces:**

- `type FahrzeugeAnsicht = 'liste' | 'tableau'`
- `fahrzeugePfad(einsatzId, { fahrzeug?, ansicht? })`
- `parseFahrzeugeAnsicht(params): FahrzeugeAnsicht | undefined`
- Sprungmarke `fms-tableau` (kategorie `kraefte`, zielModul `fahrzeuge`, nach `fahrzeuge`)

- [ ] Tests zuerst:
  - `fahrzeugePfad(7, { ansicht: 'tableau' })` ergibt das Literal `'/einsaetze/7/fahrzeuge?ansicht=tableau'`.
  - `parseFahrzeugeAnsicht` erkennt beide Werte und verwirft `'kachel'`.
  - Die Sprungmarken-Liste hat vier Einträge und den Literalpfad.
  - Panel-Reihenfolge Kräfte: `… 'fahrzeuge', '↗fms-tableau', 'material' …`
- [ ] Implementieren mit dem exhaustiven `Record<FahrzeugeAnsicht, true>`.
- [ ] Die Tests laufen grün.

### Task 2: Reines Modell `kraefte/fmsTableau.ts`

**Files:** `frontend/src/kraefte/fmsTableau.ts` + `fmsTableau.test.ts`. `pages/KraefteuebersichtPage.tsx` nutzt dazu `fmsStatusOptionen`.

**Produces:**

- **`fmsStatusOptionen(katalog)`** liefert `StatusOption<number>[]`:
  - Label: `S${anker} · ${fmsWort}` bzw. `label`
  - Darstellung aus der Kategorie, Farbe `farbe`
  - `handStatusOptionen` baut darauf auf und hängt „kein Status“ an.
- **`zifferZuordnung(katalog)`** liefert `ReadonlyMap<number, ZifferZiel>` mit
  `type ZifferZiel = { art: 'eindeutig'; status: FahrzeugStatus } | { art: 'mehrdeutig'; anzahl: number }`.
  Ein nicht belegter Anker hat keinen Eintrag.
- **`baueFmsTableau(efs, einheiten | null)`** liefert `FmsGruppe[]`:
  - `FmsGruppe = { schluessel: string; titel: string; kacheln: FmsKachel[] }`
  - `FmsKachel = { ef: EinsatzFahrzeug; einheit: string | null }`
  - Gruppen je Abschnitt, sortiert nach Name (`localeCompare('de', { numeric: true })`).
  - Danach „ohne Abschnitt“ (Einheit ohne Abschnitt), zuletzt „ohne Einheit“ (keine `einheit_id` oder unbekannte Einheit).
  - Innerhalb einer Gruppe sortiert nach Einheitenname, dann Funkrufname.
  - Bei `einheiten === null` gibt es genau eine Gruppe „Alle Fahrzeuge“, sortiert nach Funkrufname, `einheit: null`.
  - Leere Gruppen entfallen.

- [ ] Tests zuerst:
  - Zuordnung: eindeutig, doppelt, `null`-Anker und leerer Katalog.
  - Gruppen:
    - Reihenfolge der Abschnitte
    - „ohne Abschnitt“ vor „ohne Einheit“
    - unbekannte `einheit_id` landet in „ohne Einheit“
    - `null`-Einheiten ergeben die flache Gruppe
    - eine Statusänderung ändert die Reihenfolge nicht (zwei Fahrzeuge mit getauschtem Status, gleiche Folge)
  - Optionenlabel mit und ohne Anker.
- [ ] Implementieren, `handStatusOptionen` auf `fmsStatusOptionen` umstellen. Die Bestandstests der Kräfteübersicht bleiben grün.

### Task 3: `StatusWahl` bekommt ein optionales `etikett`

**Files:** `frontend/src/components/StatusWahl.tsx` + Test

- [ ] Test: Mit `etikett={<span>S4 · Am Einsatzort</span>}` trägt der Auslöser diesen Inhalt statt des `StatusTag`. Auch der Lesezweig ohne Schreibrecht zeigt ihn.
- [ ] Implementieren mit `etikett ?? (darstellung ? <StatusTag …/> : '—')` und einem Doc-Kommentar zum Wofür (Tableau-Chip).

### Task 4: Komponente `kraefte/FmsTableau.tsx`

**Files:** `frontend/src/kraefte/FmsTableau.tsx` + `FmsTableau.test.tsx`

**Consumes:** Task 2 und 3, `StatusChip`, `Paneel`, `Sammelbanner`, `Tastenkuerzel`, `useAnzeigeKonventionen` + `formatUhrzeitMitTag`, `StatusBedienung`.

**Props:**

```ts
interface FmsTableauProps {
  fahrzeuge: EinsatzFahrzeug[];
  katalog: FahrzeugStatus[];
  einheiten: Einheit[] | null;
  /** Grund, warum ungegliedert gezeigt wird (Einheiten nicht abrufbar). */
  einheitenHinweis?: string;
  darfSchreiben: boolean;
  /** Derselbe Deskriptor wie in Tabelle und Karte — ein Bedienweg. */
  bedienungVon: (ef: EinsatzFahrzeug) => StatusBedienung;
}
```

**Aufbau:**

- Wurzel `<section aria-label="FMS-Tableau" onKeyDown onFocus onBlur>`.
- Je Gruppe ein `Paneel` (Titel, Meta `n Fzg.`), darin ein CSS-Grid `repeat(auto-fill, minmax(min(100%, 208px), 1fr))`.
- **Kachel** (`data-lfh="fms-kachel"`, `data-ef-id`):
  - Funkrufname Mono 13
  - `StatusWahl` mit `etikett={<StatusChip …/>}` und `darstellung=statusDarstellung`-Äquivalent
  - „Seit HH:MM“ (Mono 11 `gedaempft`), `…` während `laeuft`, `—` ohne `status_seit`
  - Einheitenname oder „ohne Einheit“
- **Tastenhinweis** (nur bei `darfSchreiben` und mindestens einem eindeutigen Anker): „Ziffer drücken setzt den Status des fokussierten Fahrzeugs“ mit `<Tastenkuerzel>0–9</Tastenkuerzel>`.
- **Ziffernhandler:**
  - **Wirkt nicht** bei Modifikatortaste, bei einem Eingabeelement als Ziel, ohne Kachel-Vorfahr (DOM `closest`, damit zählt das Portal-Menü nicht) oder ohne Schreibrecht.
  - **Wirkt nicht, stumm**, wenn die Bedienung `gesperrt` ist.
  - `eindeutig` mit einem anderen als dem aktuellen Status → `bedienungVon(ef).onWaehlen(status.id)`.
  - `mehrdeutig` → `message.warning('Ziffer 3 ist im Statuskatalog mehrfach belegt …')`.
  - Keine Belegung → `message.info('Ziffer 7 ist keinem Status zugeordnet')`.
  - Gleicher Status → nichts tun.
- **Zuflussschleuse:**
  - Fokus tritt ein → die IDs der sichtbaren Fahrzeuge einfrieren.
  - Fokus verlässt die Wurzel, und `relatedTarget` liegt nicht in `.ant-dropdown` → auftauen.
  - Solange eingefroren, werden nur eingefrorene IDs gezeigt. Neue stehen im `Sammelbanner` „n neue Fahrzeuge“; die Aktion „anzeigen“ friert neu ein.
  - Entfernte Fahrzeuge fallen sofort weg.
- **Leer:** „Noch keine Fahrzeuge disponiert“.

- [ ] Tests zuerst (RTL, `renderMitProviders`, ohne MSW, Props direkt):
  1. Gruppenüberschriften und Kachelinhalte: Funkrufname, `S3`, Wort, „Seit“, Einheit.
  2. Ziffer 4 am fokussierten Auslöser → `onWaehlen(3)`.
  3. Ziffer 3 bei doppeltem Anker → kein Aufruf, Warnhinweis.
  4. Ziffer 9 ohne Belegung → kein Aufruf.
  5. Aktueller Status → kein Aufruf.
  6. Strg+4 → kein Aufruf.
  7. Ohne Schreibrecht: kein Auslöser, kein Hinweis.
  8. Gesperrt → kein Aufruf.
  9. `laeuft` → „Seit …“ statt der Uhrzeit.
  10. Zufluss: Fokus in der Kachel, Rerender mit einem neuen Fahrzeug → die Kachel fehlt, das Banner „1 neues Fahrzeug“ erscheint, Klick → Kachel da.
  11. Unmittelbarer Handler-Test: Blur mit `relatedTarget` in `.ant-dropdown` taut nicht auf (jsdom verschiebt den Fokus nicht ins Portal, gemessene Falle aus LFH-339).
  12. `einheiten=null` mit Hinweis → eine Gruppe „Alle Fahrzeuge“ plus Hinweistext.
- [ ] Implementieren.

### Task 5: Einbau in `FahrzeugePage`

**Files:** `frontend/src/pages/FahrzeugePage.tsx` + `FahrzeugePage.test.tsx`

- **Ansicht:** `useState<Record<number, FahrzeugeAnsicht>>` je Einsatz, Vorgabe `liste`.
  - `?ansicht=` wird apply-then-clean über `parseFahrzeugeAnsicht` übernommen, `replace`.
  - `?fahrzeug=` bleibt davon unberührt.
- **`Segmentleiste`** „Ansicht“ (Liste / FMS-Tableau) in `aktionen`, immer sichtbar, vor den Schreib-Aktionen.
- **Einheiten-Query:** `einsatzKeys.einheiten(einsatzId)`, `enabled` nur in der Tableau-Ansicht.
  - Fehler → `einheiten=null`, Hinweis „Einheiten nicht abrufbar — Fahrzeuge ohne Gliederung“.
  - Solange geladen wird ebenfalls `null`, ohne Hinweis. Ein Flackern ist akzeptiert, die Gruppen kommen nach.
- **Unverändert** für beide Ansichten: Listenfehler/-veraltet, Statuskatalog-Banner und Verdichtungszeile.

- [ ] Tests zuerst:
  - `?ansicht=tableau` zeigt das Tableau, und der Parameter ist anschließend geräumt.
  - Das Umschalten über die Segmentleiste zeigt „FMS-Tableau“ bzw. die Tabelle.
  - Ziffer 4 in der Kachel führt zu einem PATCH mit `{status_id: 3}` (MSW-Zähler).
  - Einheiten mit 403 → Hinweis und Kachel bedienbar.
- [ ] Implementieren.

### Task 6: e2e `frontend/e2e/fms-tableau.spec.ts`

- [ ] Fixture nach dem Muster von `kraefte-schmal.spec.ts`: Einsatz mit zwei Fahrzeugen, eine Einheit mit Abschnitt.
- [ ] 390, 1024 und 1366 px: kein waagerechter Querlauf (`scrollWidth <= clientWidth`), Kachel sichtbar.
- [ ] Tastatur: Auslöser fokussieren, `4` drücken → der Chip zeigt `S4`, der Serverstand bleibt nach dem Reload erhalten.

### Task 7: Prüfliste, Doku, Gates

- [ ] Prüfliste in `docs/superpowers/specs/2026-09-23-lfh-642-pruefliste.md` anlegen: 15 Kriterien mit Verdikt und schriftlich begründetem Formverdikt.
- [ ] CLAUDE.md: einen Satz beim LFH-330-Absatz ergänzen. Das FMS-Tableau ist die erste Kachel-Überblicksfläche mit Bedienung, Verweis auf die Prüfliste.
- [ ] `./scripts/check-all.sh`, ohne `| tail`.
