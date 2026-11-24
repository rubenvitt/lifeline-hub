# Fachebene Autobahn ausbauen — Umsetzungsplan (LLH-1637)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Autobahn-Ebene zeigt zusätzlich Verkehrsmeldungen, eine neue Fachebene
`autobahn_parken` zeigt die Rastanlagen mit Stellplätzen, und die Doku hält die Lizenzlage als
„nicht belegt“ fest.

**Architecture:** Der bestehende Hintergrund-Fächer (`fetch_autobahn`/`erneuere_autobahn`) bekommt
den Dienst `warning`. Ein zweiter Hintergrund-Lauf nach demselben Muster holt `parking_lorry` mit
24 h TTL, teilt sich mit dem ersten die Einzelspur (nie gleichzeitig) und nimmt nur Läufe mit
≥ 90 % beantworteten Strecken an. Das Frontend führt die neue Ebene wie jede andere Fachebene.

**Tech Stack:** Rust (axum, reqwest, tokio, serde_json), React/TypeScript, MapLibre, antd, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-x36jzkkm-fachebene-autobahn-ausbauen-design.md`

## Global Constraints

- Neue Wire-Werte: Ebene `autobahn_parken`, Kategorien `verkehrsmeldung` und `rastanlage`,
  `art` ∈ {`stau`, `zaehfliessend`, `stillstand`}; Properties deutsch wie die bestehenden.
- Attribution beider Ebenen: `Autobahn GmbH des Bundes`.
- Autobahn-Lauf: TTL 600 s, 8 gleichzeitige Abrufe, Budget 60 s, Hälfte-Schwelle bleibt.
- Parken-Lauf: TTL 24 h, Annahme nur bei ≥ 90 % beantworteten Strecken, Abkühlung 300 s,
  Einzelspur mit dem Autobahn-Lauf geteilt.
- Ladesäulen, Belegung und Linien-Geometrie bleiben draußen; Webcam-Bilder nur verlinkt.
- Geltungszeile der neuen Ebene: `nur Rastanlagen an Bundesautobahnen, ohne Belegung`.
- Prosa, Kommentare und Testnamen deutsch; Abläufe englisch (`AGENTS.md`, „Bezeichner-Sprache“).

## Review Focus

1. `delayTimeValue` als String `"0"`, leer, keine Zahl → kein `verzoegerung_min`, kein „+0 min“
   (Task 1).
2. Rastanlage ohne Stellplatzzeilen oder mit `PKW Stellplätze: ` ohne Zahl → Feld fehlt,
   Inspector zeigt „k. A.“ (Task 2, Task 5).
3. Parken-Lauf mit 89 % Antworten bei vorhandenem Stand → alter Stand bleibt, Abkühlung greift
   (Task 2/3).
4. Kalter Start: beide Ebenen eingeschaltet → beide `offline`, Läufe nacheinander, keiner
   reißt das Budget (Task 3).
5. Unbekannter `abnormalTrafficType` (`ACCIDENT` o. ä.) → kein `art`, Titel trägt die Meldung
   (Task 1).

---

### Task 1: Verkehrsmeldungen in der Autobahn-Ebene (Backend)

**Files:**
- Modify: `src/karte/normalisierung.rs` (`autobahn_kategorie`, `autobahn_label`,
  `normalisiere_autobahn`, Tests in `mod autobahn_tests`)
- Modify: `src/karte/quellen.rs` (`AUTOBAHN_DIENSTE`, Kommentar zu TTL/Abrufzahl)

**Interfaces:**
- Produces: Feature-Properties `kategorie: "verkehrsmeldung"`, `art: "stau"|"zaehfliessend"|
  "stillstand"` (optional), `verzoegerung_min: number` (optional, > 0).

- [ ] **Step 1: Failing tests** in `mod autobahn_tests`:
  - `verkehrsmeldung_wird_punkt_mit_art_und_verzoegerung`: `dienst("warning", [{title, subtitle,
    coordinate, startTimestamp: "2026-11-24T22:08:00Z", delayTimeValue: "17",
    abnormalTrafficType: "QUEUING_TRAFFIC", source: "inrix", future: false}])` →
    `kategorie == "verkehrsmeldung"`, `art == "stau"`, `verzoegerung_min == 17`,
    `beginn == "2026-11-24T22:08:00Z"`, `properties.source` ist `null`/fehlt.
  - `verkehrsmeldung_ohne_typ_und_mit_null_minuten_traegt_keine_zusaetze`:
    `delayTimeValue: "0"`, kein `abnormalTrafficType` → `art` und `verzoegerung_min` fehlen bzw.
    `null`; zweiter Eintrag `abnormalTrafficType: "ACCIDENT"`, `delayTimeValue: "x"` → ebenso.
  - `verkehrsmeldung_slow_und_stationary_traffic`: `SLOW_TRAFFIC` → `zaehfliessend`,
    `STATIONARY_TRAFFIC` → `stillstand`.
- [ ] **Step 2:** `cargo test --lib autobahn_tests` → die neuen Tests scheitern.
- [ ] **Step 3:** `autobahn_kategorie("warning") = Some("verkehrsmeldung")`, Label
  „Verkehrsmeldung“; in `normalisiere_autobahn` für diese Kategorie `art` und
  `verzoegerung_min` ergänzen (andere Kategorien bekommen die Felder nicht). In `quellen.rs`
  `AUTOBAHN_DIENSTE: [&str; 4] = ["webcam", "roadworks", "closure", "warning"]`; Kommentare zu
  Abrufzahl (~450) anpassen.
- [ ] **Step 4:** `cargo test --lib autobahn` → grün, auch `autobahn_output_passt_auf_den_geojson_anker`.
- [ ] **Step 5: Commit** `feat: Verkehrsmeldungen in der Autobahn-Ebene (LLH-1637)`.

### Task 2: Normalisierung und Annahme des Parken-Laufs (Backend, rein)

**Files:**
- Modify: `src/karte/normalisierung.rs` (neu `normalisiere_autobahn_parken`, `mod
  autobahn_parken_tests`)
- Modify: `src/karte/quellen.rs` (neu `autobahn_parken_antwort`, Tests neben
  `autobahn_strassen_tests`)

**Interfaces:**
- Produces: `pub fn normalisiere_autobahn_parken(roh: &[(String, Value)]) -> Value` (Eingabe je
  Strecke `(strasse, {"parking_lorry": […]})`); Properties `titel`, `kategorie: "rastanlage"`,
  `strasse`, `abschnitt`, `pkw_stellplaetze`, `lkw_stellplaetze`, `ausstattung: string[]`,
  `beschreibung`, `id`.
- Produces: `pub(crate) fn autobahn_parken_antwort(gesamt: usize, roh: &[(String, Value)]) ->
  Option<FachebeneAntwort>` mit `quelle = "autobahn_parken"`.

- [ ] **Step 1: Failing tests:**
  - `rastanlage_liest_name_abschnitt_stellplaetze_und_ausstattung`: Eintrag wie im Live-Befund
    (`title: "A1 | Puttgarden"`, `subtitle: "Krummhörens Kuhlen"`, `description: ["PKW
    Stellplätze: 18", "LKW Stellplätze: 4"]`, zwei `lorryParkingFeatureIcons`) →
    `titel == "Krummhörens Kuhlen"`, `abschnitt == "Puttgarden"`, `pkw_stellplaetze == 18`,
    `lkw_stellplaetze == 4`, `ausstattung == ["Toilette vorhanden", "Picknickmöglichkeiten"]`,
    `beschreibung` fehlt (alle Zeilen verbraucht).
  - `rastanlage_ohne_stellplatzzahl_laesst_felder_weg`: `["PKW Stellplätze: ", "Hinweis X"]`,
    kein `subtitle` → `pkw_stellplaetze` fehlt, `titel == "Rastanlage"`,
    `beschreibung == "Hinweis X"`.
  - `rastanlage_ohne_koordinate_faellt_weg`.
  - `parken_antwort_braucht_neunzig_prozent`: `gesamt = 10`, 9 brauchbar → `Some`; 8 brauchbar →
    `None`; 0 → `None`; Einträge ohne `parking_lorry`-Array zählen nicht.
- [ ] **Step 2:** `cargo test --lib parken` → scheitert.
- [ ] **Step 3:** Implementieren. Stellplätze per Präfix `PKW Stellplätze:` / `LKW Stellplätze:`
  (getrimmt, `u32` parsen); `abschnitt` = `title` nach dem ersten `|`, getrimmt; Koordinate über
  `autobahn_zahl`. Schwelle: `brauchbar * 10 >= gesamt * 9 && brauchbar > 0`.
- [ ] **Step 4:** `cargo test --lib parken` → grün.
- [ ] **Step 5: Commit** `feat: Normalisierung der Autobahn-Rastanlagen (LLH-1637)`.

### Task 3: Hintergrund-Lauf und Route `autobahn_parken` (Backend)

**Files:**
- Modify: `src/karte/quellen.rs` (neu `fetch_autobahn_parken`, `erneuere_autobahn_parken`,
  Konstanten `AUTOBAHN_PARKEN_TTL = 86_400 s`, eigener Fehlschlag-Merker; gemeinsame Teile mit
  `erneuere_autobahn` herausziehen: Streckenliste holen, Fächer über `(strasse, dienst)`)
- Modify: `src/routes/karte.rs` (Match-Arm `"autobahn_parken"`)
- Modify: `src/karte/cache.rs` nur falls die 48-h-Obergrenze einen 24-h-Stand verwirft
  (prüfen, nicht ändern, wenn nicht nötig)

**Interfaces:**
- Consumes: `normalisiere_autobahn_parken`, `autobahn_parken_antwort` (Task 2),
  `autobahn_weg`, `autobahn_darf_starten`, `AUTOBAHN_EINZELSPUR`.
- Produces: `pub async fn fetch_autobahn_parken(s: &FachebenenState, pool: &SqlitePool) ->
  FachebeneAntwort`; `GET /api/map/overlays/autobahn_parken`.

- [ ] **Step 1: Failing tests:**
  - In `quellen.rs`: `parken_und_autobahn_teilen_die_einzelspur` — hält ein Test die
    `AUTOBAHN_EINZELSPUR`, wartet `erneuere_autobahn_parken` (Timeout 100 ms läuft ab, ohne
    dass ein Abruf startet; Client gegen eine nicht erreichbare Adresse oder über die bestehende
    Test-Naht, wie sie die übrigen Autobahn-Tests nutzen).
  - Routen-Test (dort, wo die übrigen Fachebenen-Routen getestet werden, `grep -rn
    "overlays/autobahn" tests src`): `GET /api/map/overlays/autobahn_parken` mit kaltem Cache →
    200, `status == "offline"`, `quelle == "autobahn_parken"`,
    `attribution == "Autobahn GmbH des Bundes"`.
- [ ] **Step 2:** Tests laufen lassen → scheitern.
- [ ] **Step 3:** Implementieren nach dem Muster von `fetch_autobahn` (Frisch/Alt/Leer,
  Abkühlung, `inflight`-Schlüssel `autobahn_parken`); `erneuere_autobahn_parken` nimmt
  zuerst `AUTOBAHN_EINZELSPUR`, holt dann die Streckenliste, fächert `parking_lorry` mit
  `AUTOBAHN_PARALLEL` unter `AUTOBAHN_BUDGET`, nimmt über `autobahn_parken_antwort` an und
  schreibt `cache::setze(…, "autobahn_parken", …)` (Schreibfehler = Fehlschlag, wie beim
  Autobahn-Lauf).
- [ ] **Step 4:** `cargo test --lib karte` und den Routen-Test → grün; `cargo clippy` ohne neue
  Warnungen in den berührten Dateien.
- [ ] **Step 5: Commit** `feat: Fachebene Lkw-Parkplätze an Bundesautobahnen (LLH-1637)`.

### Task 4: Verkehrsmeldung im Frontend

**Files:**
- Modify: `frontend/src/pages/lagekarte/fachebenenLayer.ts` (`KATEGORIE_LABEL`:
  `verkehrsmeldung: 'Verkehrsmeldung'`, `rastanlage: 'Rastanlage'`)
- Modify: `frontend/src/pages/lagekarte/FachebenenInspector.tsx` (`AutobahnInhalt`)
- Test: `frontend/src/pages/lagekarte/FachebenenInspector.test.tsx`

Farben bleiben je Ebene (es gibt keine Farbe je Kategorie); die Meldung unterscheidet sich über
Marke und Kopfzeile.

- [ ] **Step 1: Failing test** `'Autobahn/Verkehrsmeldung: Art und Reisezeitverlust stehen
  oben'`: Feature `{kategorie: 'verkehrsmeldung', art: 'stau', verzoegerung_min: 17, titel,
  richtung}` → sichtbar „Verkehrsmeldung“, „Stau“, „+17 min“; zweiter Fall ohne `art` und
  `verzoegerung_min` → weder „Stau“ noch „min“ im Text.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run
  src/pages/lagekarte/FachebenenInspector.test.tsx` → scheitert.
- [ ] **Step 3:** In `AutobahnInhalt` für `verkehrsmeldung` eine Zeile über den Descriptions:
  Art-Wort (`stau` → „Stau“, `zaehfliessend` → „Zähfließend“, `stillstand` → „Stillstand“) und
  „+N min Reisezeitverlust“.
- [ ] **Step 4:** Test → grün.
- [ ] **Step 5: Commit** `feat: Verkehrsmeldung im Inspector der Autobahn-Ebene (LLH-1637)`.

### Task 5: Neue Ebene `autobahn_parken` im Frontend

**Files:**
- Modify: `frontend/src/api/fachebenen.ts` (`FachebeneQuelle`)
- Modify: `frontend/src/api/types.ts` (`FachebenenSichtbar` um `autobahn_parken?`, falls der
  Typ dort gepflegt wird) und `frontend/src/pages/lagekarte/useKartenAnsicht.ts`
- Modify: `frontend/src/pages/lagekarte/fachebenenAuswahl.ts`, `fachebenen.ts`
  (`FACHEBENEN.autobahn_parken`, `fachebeneKeys()` direkt nach `autobahn`),
  `leistenDaten.ts` (Gruppe mit `autobahn`), `useFachebenen.ts` (Query im `useQueries`-Tupel
  **am Ende**, Aufwärmtakt wie `autobahn` über einen eigenen Status-State)
- Modify: `frontend/src/theme/tokens.ts`, `frontend/src/theme/statusFarben.ts` (neuer Ton
  `autobahn_parken`, hell und dunkel, unterscheidbar von `autobahn`),
  `docs/design/design-system/project/tokens.json` falls er die Töne spiegelt
- Modify: `frontend/src/pages/lagekarte/FachebenenInspector.tsx` (`RastanlageInhalt`, Zweig
  `quelle === 'autobahn_parken'`), `fachebeneTitel.ts` falls je Quelle gepflegt
- Tests: `fachebenen.test.ts`, `statusFarben.test.ts`, `leistenDaten.test.ts`,
  `FachebenenInspector.test.tsx`, `Sidebar.test.tsx` je nach vorhandener Inventarprüfung

**Interfaces:**
- Consumes: Properties aus Task 2.
- Produces: `FACHEBENEN.autobahn_parken = { key, label: 'Lkw-Parkplätze (BAB)', geometrieTyp:
  'punkt', pollMs: 30 * 60_000, bboxAbhaengig: false, aufwaermPollMs: 20_000, geltung: 'nur
  Rastanlagen an Bundesautobahnen, ohne Belegung', veraltetNachMin: 48 * 60 }`.

- [ ] **Step 1: Failing tests:**
  - `fachebenen.test.ts`: Reihenfolge enthält `'autobahn', 'autobahn_parken'` hintereinander;
    `fachebeneTakt('autobahn_parken', 'offline') === 20_000`, `'ok'` → `30 * 60_000`;
    `istBboxAbhaengig('autobahn_parken') === false`; Default-Sichtbarkeit `false`.
  - `FachebenenInspector.test.tsx` `'Lkw-Parken: Name, Autobahn, Abschnitt, Stellplätze und
    Ausstattung'`: `{titel: 'Krummhörens Kuhlen', strasse: 'A1', abschnitt: 'Puttgarden',
    pkw_stellplaetze: 18, lkw_stellplaetze: 4, ausstattung: ['Toilette vorhanden']}` →
    sichtbar „Pkw 18 · Lkw 4“, „Toilette vorhanden“; ohne Stellplätze → „Pkw k. A. · Lkw k. A.“.
  - `statusFarben.test.ts`: bestehende Abstandsprüfung der Töne schließt den neuen Ton ein.
- [ ] **Step 2:** Vitest für die genannten Dateien → scheitert.
- [ ] **Step 3:** Implementieren; `tsc` (`mise exec -- pnpm -C frontend exec tsc --noEmit`)
  zeigt jede exhaustive `Record<FachebeneQuelle, …>`, die noch fehlt.
- [ ] **Step 4:** `mise exec -- pnpm -C frontend exec vitest run src/pages/lagekarte
  src/theme` und `tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Ebene Lkw-Parkplätze (BAB) in der Lagekarte (LLH-1637)`.

### Task 6: Doku und Messung

**Files:**
- Modify: `docs/fachebenen-quellen.md` (Tabellenzeile Autobahn um `warning`, neue Zeile
  `autobahn_parken`, Tabelle TTL/Veraltet und Messtabelle, Lizenz-Vorbehalt neu nach „Befund
  Lizenz“ des Entwurfs, Eigenheiten: INRIX-Anteil, `abnormalTrafficType` oft leer, Stellplätze
  nur als Text)
- Modify: `docs/anwender/kapitel/lagekarte.md` (Ebenenliste, Meldung, Rastanlage; Regeln in
  `docs/anwender/AGENTS.md`)
- Modify: `docs/architektur/03-kontextabgrenzung.md`, `05-bausteinsicht.md` soweit dort
  Autobahn-Dienste oder Ebenen aufgezählt sind (`docs/architektur/AGENTS.md`)

- [ ] **Step 1:** Messung am Backend: ein Lauf je Ebene mit `cargo run` und Abruf der Route,
  Anzahl Features, Antwortgröße, Laufzeit aus dem Log notieren.
- [ ] **Step 2:** Texte schreiben; `grep -rn "dl-de/by-2-0" docs/fachebenen-quellen.md` zeigt bei
  Autobahn keinen Treffer mehr.
- [ ] **Step 3:** Wächter der Doku laufen lassen (`./scripts/check-all.sh --geaendert
  --ohne-e2e` deckt sie ab).
- [ ] **Step 4: Commit** `docs: Autobahn-Ebenen und Lizenzbefund (LLH-1637)`.

### Task 7: Abschluss

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] Bilder der Änderung (Verkehrsmeldung, Rastanlage, Leiste mit neuer Ebene) per Wegwerf-Spec.
- [ ] Review nach Ermessen (Anlass prüfen: Größe, Backend + Frontend mit neuer Schnittstelle).
