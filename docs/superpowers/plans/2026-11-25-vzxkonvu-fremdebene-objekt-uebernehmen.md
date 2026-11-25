# Objekt aus einer Fremdebene übernehmen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An einem Fremdebenen-Objekt „Übernehmen“ legt daraus Zonen bzw. freie Zeichen des
Einsatzes an, mit serverseitigem Herkunftsvermerk im ETB.

**Architecture:** Die bestehenden POST-Routen für Zonen und freie Zeichen nehmen optional
`fremdebene_id`; der Server baut daraus den Herkunftstext und schreibt ihn im selben Tx ins ETB.
Das Frontend zerlegt die volle Geometrie aus `fr.daten.features[index]` in Einzelteile und legt
sie nacheinander an.

**Tech Stack:** Rust/axum/sqlx (SQLite), React/antd/TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-vzxkonvu-fremdebene-objekt-uebernehmen-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/vzxkonvuigfqz37jfifcq3gj

## Global Constraints

- Neues Body-Feld heißt `fremdebene_id` (deutsch wie die übrigen Felder der Bodies).
- Herkunftstext: `übernommen aus Fremdebene «<name>», Datei` bzw. `…, von <url_host>`.
- Zone: `<bisheriger ETB-Text> (<herkunft>)`. Freies Zeichen: `Freies Zeichen «<label>» <herkunft>`
  bzw. ohne Label `Freies Zeichen <herkunft>`.
- Fremde/unbekannte Ebene → 404. Ohne `fremdebene_id` bleibt alles wortgleich wie heute.
- Zonenarten: Fläche → gefahrengebiet (Vorgabe), absperrbereich, sperrgebiet, freie_skizze;
  Linie → absperrgrenze (Vorgabe), freie_skizze. Kein evakuierungsbezirk.
- Höchstens 20 Teile je Objekt; gemischte GeometryCollection nicht übernehmbar.
- Label = Objektname, sonst Ebenenname; bei n > 1 Teilen Suffix ` (i/n)`; Zonen-Label auf
  `ZONE_LABEL_MAX` (200) gekürzt, Suffix bleibt erhalten.
- Zonen-Notiz: `Übernommen aus Fremdebene «<ebene>».` + `\n\n` + Beschreibung, auf
  `ZONE_NOTIZ_MAX` (2000) gekürzt. Freie Skizze mit `FREIE_SKIZZE_VORGABEFARBE`.
- Prosa/Tests deutsch, Technikbezeichner englisch (`AGENTS.md`, „Bezeichner-Sprache“).

## Review Focus

- Objekt ohne `name` → Label fällt auf den Ebenennamen zurück (Task 3).
- Polygon mit Loch → Loch bleibt in der angelegten Zone erhalten (Task 3).
- Abbruch mittendrin (422 bei Teil 2 von 3) → Meldung nennt „1 von 3 übernommen“ (Task 4).
- Nutzer ohne Schreibrecht / Verlaufsansicht → kein Knopf (Task 4).
- Ebene inzwischen gelöscht (Klick-Auswahl veraltet) → 404 vom Server wird als Fehler gemeldet,
  kein Absturz (Task 4, Fehlerpfad derselben Meldung).

---

### Task 1: Herkunft an der Zonen-Anlage

**Files:**
- Modify: `src/karte_fremdebene/mod.rs` (neue Funktion), `src/routes/lage_zone.rs` (`ZoneBody`, `anlegen`)
- Test: `tests/karte_fremdebene.rs`

**Interfaces:**
- Produces: `pub fn herkunft_text(ebene: &FremdebeneAnzeige) -> String` in `karte_fremdebene`;
  `pub async fn herkunft_fuer(pool, einsatz_id, Option<i64>) -> Result<Option<String>, AppError>`
  (lädt per `repo::laden`, 404 durchgereicht).

- [x] **Step 1: Failing tests** in `tests/karte_fremdebene.rs` (Ebene per `hochladen` aus `ZWEI_PUNKTE`, Name „Lage Kreis X“):
  - `zone_mit_fremdebene_traegt_herkunft_im_etb`: POST zones gefahrengebiet, label „Brandfläche“, `fremdebene_id` → 201; `system_etb_inhalte` enthält genau
    `Gefahrengebiet «Brandfläche» eingerichtet (übernommen aus Fremdebene «Lage Kreis X», Datei)`.
  - `zone_mit_fremder_fremdebene_ist_404`: Ebene aus anderem Einsatz → 404, keine Zone angelegt.
  - Unit-Test in `mod.rs`: `herkunft_text` für Quelle `url` mit `url_host = Some("lage.example.org")` → `übernommen aus Fremdebene «X», von lage.example.org`.
- [x] **Step 2:** `cargo test --test karte_fremdebene zone_mit` → FAIL (unbekanntes Feld wird ignoriert, Text ohne Herkunft).
- [x] **Step 3:** `fremdebene_id: Option<i64>` an `ZoneBody`; in `anlegen` nach `pruefe_zugehoerig` `herkunft_fuer` aufrufen; im Tx den Text als `format!("{text} ({h})")` bauen. Länge gegen `etb::INHALT_MAX` prüfen (400 bei Überlänge, praktisch unerreichbar).
- [x] **Step 4:** Tests grün; `cargo test --test lage_zone` weiter grün (Text ohne Feld unverändert).
- [x] **Step 5:** Commit `feat: Zone mit Herkunft aus Fremdebene anlegen (LLH-2129)`.

### Task 2: Herkunft am freien Zeichen

**Files:**
- Modify: `src/routes/freies_zeichen.rs` (`AnlegenBody`, `anlegen`), ggf. `src/freies_zeichen/repo.rs` (`anlegen_tx`, falls es nur die Pool-Variante gibt)
- Test: `tests/karte_fremdebene.rs`

**Interfaces:**
- Consumes: `karte_fremdebene::herkunft_fuer`, `herkunft_text` (Task 1).

- [x] **Step 1: Failing tests:**
  - `zeichen_mit_fremdebene_schreibt_system_etb`: POST free-symbols mit Spec `STELLE_SANITAET` (aus `tests/freies_zeichen.rs` kopieren), label „Sammelpunkt“, `fremdebene_id` → 201; ETB enthält `Freies Zeichen «Sammelpunkt» übernommen aus Fremdebene «Lage Kreis X», Datei`.
  - `zeichen_ohne_fremdebene_schreibt_kein_etb`: dieselbe Anlage ohne Feld → Zahl der System-ETB-Einträge unverändert.
  - `zeichen_mit_fremder_fremdebene_ist_404`.
- [x] **Step 2:** Tests rot.
- [x] **Step 3:** Mit `fremdebene_id`: `etb_startwert` + `write_retry!` mit Zeichen-INSERT und `etb::system_audit_tx` (Muster `routes/lage_zone.rs::anlegen`), danach `super::etb_verteilen` und `sse_zeichen`. Ohne: bisheriger Weg unverändert.
- [x] **Step 4:** Tests grün; `cargo test --test freies_zeichen` grün.
- [x] **Step 5:** Commit `feat: Freies Zeichen mit Herkunft aus Fremdebene anlegen (LLH-2129)`.

### Task 3: Zerlegen und Bodies bauen (rein)

**Files:**
- Create: `frontend/src/pages/lagekarte/fremdebeneUebernahme.ts`, `…/fremdebeneUebernahme.test.ts`
- Modify: `frontend/src/api/lagezonen.ts` (`ZoneNeu.fremdebene_id?: number`), `frontend/src/api/freieZeichen.ts` (`legeFreiesZeichenAn(einsatzId, daten: NeuesFreiesZeichen & { fremdebene_id?: number })` — nicht in `NeuesFreiesZeichen`, sonst erbt `FreiesZeichenUpdate` das Feld)

**Interfaces:**
- Produces:
  - `type UebernahmeArt = 'flaeche' | 'linie' | 'punkt'`
  - `type UebernahmeTeil = { art: 'flaeche'; geometrie: Polygon } | { art: 'linie'; geometrie: LineString } | { art: 'punkt'; geometrie: Point }`
  - `zerlege(geometrie: Geometry | null): { teile: UebernahmeTeil[] } | { grund: 'gemischt' | 'zu_viele' | 'leer' }`
  - `const UEBERNAHME_TEILE_MAX = 20`
  - `zonenArtenFuer(art: 'flaeche' | 'linie'): ZoneTypInfo[]` (aus `ZONE_TYPEN`, ohne evakuierungsbezirk; Vorgabe = erstes Element)
  - `uebernahmeLabel(name: string | null, ebenenName: string, i: number, n: number): string`
  - `uebernahmeNotiz(ebenenName: string, beschreibung: string | null): string`

- [x] **Step 1: Failing tests:** Point → 1 punkt; MultiPolygon mit 3 Teilen → 3 flaeche, Loch-Ring des ersten erhalten; MultiLineString → linie; GeometryCollection aus 2 Polygonen → 2 flaeche; aus Polygon+Point → `{grund:'gemischt'}`; MultiPoint mit 21 Punkten → `{grund:'zu_viele'}`; `null` → `{grund:'leer'}`; `zonenArtenFuer('flaeche')` Typen `['gefahrengebiet','absperrbereich','sperrgebiet','freie_skizze']`, `('linie')` → `['absperrgrenze','freie_skizze']`; `uebernahmeLabel(null,'Ebene',0,1)` = `'Ebene'`, `('A','E',1,3)` = `'A (2/3)'`, 250-Zeichen-Name mit n=3 → Länge 200 und endet auf ` (1/3)`; `uebernahmeNotiz('E','Text')` = `'Übernommen aus Fremdebene «E».\n\nText'`, ohne Beschreibung nur der Satz, Gesamtlänge ≤ 2000.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/pages/lagekarte/fremdebeneUebernahme.test.ts` → FAIL.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** Test grün; `mise exec -- pnpm -C frontend exec tsc -b` sauber.
- [x] **Step 5:** Commit `feat: Fremdebenen-Objekt in übernehmbare Teile zerlegen (LLH-2129)`.

### Task 4: Knopf, Dialog und Anlage in der Lagekarte

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx` (`onFremdebeneKlick(properties, ebeneId, index: number)`; Index = `gewinner.merkmal.id` als Zahl), `frontend/src/pages/LagekartePage.tsx` (Auswahl `{ebeneId, properties, index}`, Feature aus `daten.features[index]`, Props an Detail), `frontend/src/pages/lagekarte/FremdebeneDetail.tsx`
- Create: `frontend/src/pages/lagekarte/FremdebeneUebernehmenDialog.tsx`, `frontend/src/pages/lagekarte/useFremdebeneUebernahme.ts`
- Test: `frontend/src/pages/lagekarte/FremdebeneDetail.test.tsx` (erweitern), `…/FremdebeneUebernehmenDialog.test.tsx`

**Interfaces:**
- Consumes: alles aus Task 3; `ZeichenWahlDialog` (`onPlatzieren(spec: FreiesZeichenUpdate)`); `legeZoneAn`, `legeFreiesZeichenAn`.
- Produces:
  - `FremdebeneDetail` neue Props `geometrie: Geometry | null`, `darfSchreiben: boolean`, `onUebernehmen?: () => void`.
  - `useFremdebeneUebernahme({ einsatzId, ansichtId })` → `{ uebernehme(p: { ebene: Fremdebene; teile: UebernahmeTeil[]; name: string | null; beschreibung: string | null; zonenTyp?: ZoneTyp; spec?: FreiesZeichenUpdate }): Promise<void>; laeuft: boolean }`.

- [x] **Step 1: Failing tests:**
  - Detail: mit `darfSchreiben` und Polygon zeigt Knopf „Übernehmen“; ohne Schreibrecht kein Knopf; gemischte Geometrie → Knopf deaktiviert mit Tooltip „Gemischte Objekte lassen sich nicht übernehmen“; 21 Punkte → „Mehr als 20 Teile lassen sich nicht übernehmen“.
  - Dialog (Fläche): Radio mit vier Arten, Gefahrengebiet vorgewählt; „Übernehmen“ ruft `onBestaetigen('gefahrengebiet')`.
  - Hook (mit gemocktem `legeZoneAn`): 2 Flächen → zwei Aufrufe mit `geometrie_typ:'Polygon'`, `fremdebene_id`, `ansicht_id`, Label `A (1/2)`/`A (2/2)`, Notiz laut Task 3; freie_skizze mit `farbe: FREIE_SKIZZE_VORGABEFARBE`; zweiter Aufruf wirft → Fehlermeldung enthält „1 von 2 übernommen“; Erfolg → `einsatzKeys.zonen` und `einsatzKeys.gefahrengebiete` invalidiert, Meldung „2 Objekte übernommen“ (bei 1: „Objekt übernommen“). Punkte: `legeFreiesZeichenAn` mit `lat/lon` aus den Koordinaten, `...spec`, `label`, `fremdebene_id`; invalidiert `einsatzKeys.freieZeichen`.
- [x] **Step 2:** Tests rot.
- [x] **Step 3:** Implementieren. Fläche/Linie → `FremdebeneUebernehmenDialog` (antd `Modal` im Stil von `ZeichenWahlDialog`: `mask={{ closable: false }}`, `MASKE_HAELT_FOKUS`, `Knopfreihe fuss`); Punkt → `ZeichenWahlDialog` (`quelle: 'maus'`), Knopf „Platzieren“ startet hier direkt die Anlage. Fehler über `beginneHandlung`-Muster wie in `useKartenInteraktion`. Nach Erfolg Detail schließen. In der Verlaufsansicht ist `darfSchreiben` falsch zu übergeben (gleiche Bedingung wie beim übrigen Zeichnen in `LagekartePage`).
- [x] **Step 4:** Tests grün; `mise exec -- pnpm -C frontend exec vitest run src/pages/lagekarte` grün; `tsc -b` und `pnpm lint` sauber.
- [x] **Step 5:** Commit `feat: Fremdebenen-Objekt in der Lagekarte übernehmen (LLH-2129)`.

### Task 5: Doku, Gates

- [x] **Step 1:** `docs/anwender/AGENTS.md` lesen; im Fremdebenen-Abschnitt der Anwenderdoku „Objekt übernehmen“ ergänzen, wenn die Mitänderungsregel es verlangt. `docs/architektur` nur, wenn deren Mitänderungsregel greift.
- [x] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e`: Schnellprüfungen grün; Rust-/Frontend-Suite im Container nicht vollständig lauffähig (Platte/Zeitlimit, doppelte Migration 0381 auf alpha), gezielte Suiten grün — siehe PR „Geprüft“.
- [x] **Step 3:** Commit `docs: Objekt aus Fremdebene übernehmen (LLH-2129)`.
