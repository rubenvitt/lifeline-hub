# Geodaten-Austausch und ICS der Lagebesprechung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lagekarte als GeoJSON/KMZ exportieren (LLH-2098), Fremdebenen aus Datei und URL zeigen (LLH-2099, LLH-2100), Lagebesprechungstermin als ICS herunterladen (LLH-2101).

**Architecture:**
- Der Export ist reines Frontend: reine Funktionen unter `frontend/src/pages/lagekarte/`.
- Fremdebenen sind ein neues Backend-Modul `src/karte_fremdebene/` (Tabellen, Einlesen, Routen, URL-Abruf beim Lesen) mit Ebene, Baumgruppe und Dialog im Frontend.
- ICS erzeugt eine reine Funktion in `src/lagebesprechung/ics.rs` hinter einer Leseroute. Android öffnet Kalenderdateien per `ACTION_VIEW`.
- Neue Einsatzrouten liegen unter `/api/incidents/{id}/…`.

**Tech Stack:** Rust (axum, sqlx/SQLite, quick-xml, zip), React/TypeScript (MapLibre, @einsatzzeichen, fflate), Kotlin (Android-Kern).

**Spec:**
- `docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md` (A)
- `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md` (B+C)
- `docs/superpowers/specs/2026-11-24-p133o8h2-lagebesprechung-ics-design.md` (D)

Ausführende lesen den zur Aufgabe gehörenden Spec mit.

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Abläufe englisch (`load_`, `build_`, `write`, `collect`); Prosa, Kommentare, Testbeschreibungen und Commits deutsch (Wurzel-`AGENTS.md`, „Bezeichner-Sprache“).
- Neue Routen ausschließlich unter `/api/incidents/{id}/…`; neue Segmente ins Glossar `scripts/api-routen-woerter.tsv` (sortiert): `foreign-layers	Fremdebenen`. `scripts/api-routen-bestand.txt` wächst nicht.
- Neue Request-/Response-Typen haben englische Wire-Felder (Rust-Feld = Wire-Feld). Nach DTO-/Enum-Änderung `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten.
- Jeder Handler zieht genau ein Gate (ADR-0005): Lesen `EinsatzLesezugriff<Lagekarte>` bzw. `<Lagebesprechung>`, Schreiben `EinsatzSchreibzugriff<Lagekarte>`.
- Feste Wertemengen als `wire_enum!` (ADR-0006), jede Variante im Enum-Kontrakt `tests/enum_wire_kontrakt.rs`.
- Zeitpunkte in DB und Wire als UTC `zeit::FORMAT` (ADR-0012).
- Migration: nächste freie Nummer größer als jede auf `origin/alpha` (heute ab `0373`), bestehende nie ändern.
- Grenzen Fremdebene:
  - Datei ≤ 10 MiB, KMZ entpackt ≤ 20 MiB;
  - ≤ 5000 Objekte, ≤ 200 000 Stützpunkte gesamt, ≤ 5000 je Linie oder Ring;
  - normiertes GeoJSON ≤ 8 MiB;
  - `name` ≤ 120 (Ebene) bzw. ≤ 200 (Objekt), `description` ≤ 1000;
  - Koordinaten auf 6 Nachkommastellen;
  - gespiegelt in `frontend/src/api/eingabegrenzen.ts`.
- URL-Ebene: nur `https`, `check_url`, keine Weiterleitung, Nachholen höchstens alle 60 s beim Lesen; Client-`refetchInterval` 60 s.
- ICS:
  - DTEND = DTSTART + 30 min, `VALARM` `TRIGGER:-PT10M`;
  - `SUMMARY:Lagebesprechung – <bezeichnung>`;
  - UID `lagebesprechung-<einsatz_id>-<YYYYMMDDTHHMMSSZ>@<instanz_kennung>`, `SEQUENCE:0`;
  - CRLF, Faltung bei 75 Oktetten;
  - `Content-Type: text/calendar; charset=utf-8; method=PUBLISH`.
- Oberflächentexte: kein Satz nennt Dateiformate; Formatnamen nur als Wahl („Exportieren: Google Earth (KMZ)“, „Exportieren: GIS (GeoJSON)“).
- Frontend-Befehle nur über `mise exec -- pnpm -C frontend …`; kein `| tail` um Gate-Kommandos.
- Commit-Body je Aufgabe: Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/<id>` der Unteraufgabe; Abschlusszeilen `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_01BgRwpYLu6teh8MFqVn2k8j`.
  - A `k9tkgroujn207hq8kzyyelrw`
  - B `nk5bt34vnamokity1l3izqyo`
  - C `jgmuoqbeycimf0dadl664who`
  - D `p133o8h2jfikuow48jczhlw9`
  - übergreifend `qe5jrctdg8potsextw9e6ikp`

## Review Focus

1. **KML mit DTD oder externer Entity** (Billion Laughs, `<!ENTITY x SYSTEM "file:///etc/passwd">`) → sofort `dtd`, nichts aufgelöst, kein Netz. Test in Task 12.
2. **KMZ-Bombe** (kleiner Zip-Kopf, riesige entpackte `doc.kml`) → `zu_gross`, beim Lesen gedeckelt, nicht aus dem Kopf geglaubt. Test in Task 12.
3. **Fremde GeoJSON-Datei mit Koordinaten in Web-Mercator-Metern** (lon > 180) → `koordinaten` mit dem WGS84-Hinweis, nicht still verworfen. Test in Task 11.
4. **URL-Quelle antwortet 500 oder mit Weiterleitung, nachdem sie schon Daten lieferte** → letzter Stand bleibt sichtbar, `error` gesetzt, Weiterleitung nie gefolgt. Test in Task 15.
5. **Einsatzbezeichnung mit Komma, Semikolon, Zeilenumbruch und langem Umlauttext** → ICS bleibt gültig (Escaping, Faltung ohne geteiltes UTF-8-Zeichen). Test in Task 3.

---

## Teil 0 — Grundlage

### Task 1: Einsatzrouten unter `/api/incidents/{id}` zulassen

**Files:**
- Modify: `src/einsatz/modul.rs` (`PFAD_KEY` ~154 ff., `EINSATZ_WURZEL` :309, `key_fuer_pfad` :315)
- Modify: `tests/einsatz_kontext_guard.rs:190`, `tests/geraet_routen_guard.rs:137,184`, `tests/stammdaten_live_guard.rs:108`
- Modify: `scripts/api-routen-woerter.tsv` (Zeile `foreign-layers	Fremdebenen`, sortiert)

**Interfaces:**
- Produces: `pub fn key_fuer_pfad(pfad: &str) -> Option<…>` (bestehende Signatur) ordnet `/api/incidents/{id}/map/…` → `lagekarte` und `/api/incidents/{id}/briefing…` → `lagebesprechung` zu. Die Präfixe stehen in `pub const EINSATZ_WURZELN: [&str; 2] = ["/api/einsaetze/{id}", "/api/incidents/{id}"]`.
- Die Guards prüfen jede Route, die mit einem Eintrag aus `EINSATZ_WURZELN` beginnt.

- [x] **Step 1: Failing Unit-Test** in `modul.rs`: `incidents_praefix_hat_denselben_modulschluessel` mit
  - `assert_eq!(key_fuer_pfad("/api/incidents/{id}/map/foreign-layers"), key_fuer_pfad("/api/einsaetze/{id}/map/background-images"))`;
  - dasselbe für `/briefing/schedule/export` gegen `/briefing`.
- [x] **Step 2:** `cargo test --lib einsatz::modul` → FAIL.
- [x] **Step 3:** Präfix-Normalisierung umsetzen:
  - `key_fuer_pfad` ersetzt ein führendes `/api/incidents/{id}` durch `/api/einsaetze/{id}`, bevor in `PFAD_KEY` gesucht wird;
  - `EINSATZ_WURZELN` einführen und in den drei Guard-Tests statt des Literals nutzen;
  - `EINSATZ_WURZEL` bleibt für bestehende Aufrufer.
- [x] **Step 4:** Prüfen:
  - `cargo test --lib einsatz::modul` → PASS;
  - `cargo test --test einsatz_kontext_guard --test geraet_routen_guard --test stammdaten_live_guard` → PASS;
  - `scripts/check-api-routen.sh` → grün.
- [x] **Step 5:** Commit `feat: Einsatzrouten unter /api/incidents/{id} zulassen` (übergreifende Zunder-Zeile).

### Task 2: ADR Geodaten

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-<nächste>-geodaten-verlassen-das-system-aus-dem-client-fremde-nur-gepruef-ueber-den-server.md` (Vorlage `VORLAGE.md`, < 80 Zeilen)
- Modify: das ADR-Verzeichnis, das `scripts/adr-fuer.sh --alle` liest, falls es eines führt (`docs/architektur/AGENTS.md`)

**Inhalt der ADR:**
- MUST: Export nur im Client, nur Sichtbares, keine Personen-, Führungs-, Tier- oder Meldungsmarker, keine Freitexte außer Name bzw. Label.
- MUST: Fremdgeodaten parst nur der Server.
- MUST NOT: DTD oder Entities auflösen, verlinkten Inhalten folgen.
- MUST: URL nur über `adapter::ziel` mit `check_url`, nur `https`, LAN nur mit Org-Schalter.
- `gilt_fuer`: `frontend/src/pages/lagekarte/geo*`, `frontend/src/pages/lagekarte/kmz*`, `frontend/src/pages/lagekarte/kml*`, `src/karte_fremdebene/**`.
- `herleitung`: die zwei Design-Docs A und B+C.

- [x] **Step 1:** ADR schreiben, Nummer nach `docs/architektur/AGENTS.md` vergeben.
- [x] **Step 2:** Wächter der ADRs laufen lassen (`./scripts/check-all.sh --geaendert --ohne-e2e`, nur der ADR-Schritt bzw. der Befehl, den `docs/architektur/AGENTS.md` nennt) → grün.
- [x] **Step 3:** Commit `docs: ADR Geodaten-Austausch`.

## Teil D — ICS (LLH-2101)

### Task 3: ICS-Generator

**Files:**
- Create: `src/lagebesprechung/ics.rs`
- Modify: `src/lagebesprechung/mod.rs` (`pub mod ics;`)

**Interfaces:**
- Produces:
  - `pub struct IcsEingabe<'a> { pub einsatz_id: i64, pub bezeichnung: &'a str, pub termin: chrono::DateTime<Utc>, pub instanz_kennung: &'a str }`;
  - `pub fn build_ics(eingabe: &IcsEingabe<'_>, jetzt: DateTime<Utc>) -> String`;
  - `pub fn build_dateiname(einsatz_id: i64, termin: DateTime<Utc>) -> String`, ergibt `lagebesprechung-einsatz-<id>-<YYYY-MM-DD-HHMM>.ics`.

- [x] **Step 1:** Failing Tests:
  - `jede_zeile_endet_mit_crlf_und_ist_hoechstens_75_oktette`: lange Umlaut-Bezeichnung; jede Zeile `.len() <= 75` ohne CRLF, Fortsetzungen beginnen mit `' '`, `String::from_utf8` jeder Zeile ok.
  - `escaping_nach_rfc5545`: Bezeichnung `"A, B; C\\D\r\nE"` ergibt entfaltet `SUMMARY:Lagebesprechung – A\, B\; C\\D\nE`; ein Steuerzeichen `\u{7}` fehlt.
  - `dauer_dreissig_minuten_und_alarm`: Termin `2026-11-24T14:30:00Z` → `DTSTART:20261124T143000Z`, `DTEND:20261124T150000Z`, `TRIGGER:-PT10M`, `SEQUENCE:0`, `METHOD:PUBLISH`, kein `ORGANIZER` und kein `ATTENDEE`.
  - `uid_je_termin`: `UID:lagebesprechung-42-20261124T143000Z@<kennung>`; anderer Termin → andere UID.
  - `bezeichnung_wird_auf_200_zeichen_gekuerzt`.
- [x] **Step 2:** `cargo test --lib lagebesprechung::ics` → FAIL.
- [x] **Step 3:** Implementieren:
  - Faltung auf Bytes, an Zeichengrenzen zurückweichend; die Fortsetzungszeile zählt ihr Leerzeichen mit;
  - Textsäuberung vor dem Escaping: `\r\n` und `\r` → `\n`, andere Steuerzeichen außer `\t` entfernen.
- [x] **Step 4:** `cargo test --lib lagebesprechung::ics` → PASS.
- [x] **Step 5:** Commit `feat: ICS-Generator für den Lagebesprechungstermin` (Zunder D).

### Task 4: ICS-Route

**Files:**
- Modify: `src/routes/lagebesprechung.rs` (Handler `export_termin`)
- Modify: `src/app.rs` bei :874-886 (`.route("/api/incidents/{id}/briefing/schedule/export", get(routes::lagebesprechung::export_termin))`)
- Modify: `src/instanz/fuehrung/repo.rs` bzw. `identitaet.rs`: nur lesender Zugriff auf `kennung`, etwa `pub async fn load_kennung(pool) -> Result<Option<String>, AppError>` mit `SELECT kennung FROM instanz_identitaet`, ohne `load_or_create`
- Test: `tests/lagebesprechung_ics.rs` (Testaufbau wie die bestehenden Lagebesprechungs-Integrationstests)

**Interfaces:**
- Consumes: `build_ics`, `build_dateiname` (Task 3); `repo::load_stand` (`src/lagebesprechung/repo.rs:47`); `anhang::content_disposition`.
- Produces: `pub async fn export_termin(State(state): State<AppState>, ctx: EinsatzLesezugriff<Lagebesprechung>) -> Result<Response, AppError>`.
  - Fehlt die Kennung, nimmt die UID `org-<org_id>`.

- [x] **Step 1:** Failing Tests:
  - `ics_export_liefert_kalenderdatei`: 200; `content-type` = `text/calendar; charset=utf-8; method=PUBLISH`; `cache-control` = `no-store`; `content-disposition` enthält `lagebesprechung-einsatz-`; der Body beginnt mit `BEGIN:VCALENDAR\r\n`.
  - `ics_export_ohne_termin_ist_404`.
  - `ics_export_ohne_mitgliedschaft_verweigert` (gleiches Gate-Verhalten wie `GET /briefing`).
  - `ics_export_bei_ueberfaelligem_termin_200`.
- [x] **Step 2:** `cargo test --test lagebesprechung_ics` → FAIL.
- [x] **Step 3:** Handler wie `src/routes/einsatzakte.rs:177-191`, mit dem Body als `String`.
- [x] **Step 4:** Prüfen:
  - `cargo test --test lagebesprechung_ics --test einsatz_kontext_guard --test zulassung_guard` → PASS;
  - `scripts/check-api-routen.sh` → grün.
- [x] **Step 5:** Commit `feat: Route für den ICS-Export der Lagebesprechung` (Zunder D).

### Task 5: Knopf „In Kalender übernehmen“ und Dateiname

**Files:**
- Modify: `frontend/src/components/dateiSpeichern.ts`, `frontend/src/components/useCsvExport.ts` (Aufrufer anpassen)
- Modify: `frontend/src/api/lagebesprechung.ts`, `frontend/src/lagebesprechung/TerminPaneel.tsx`
- Test: `frontend/src/components/dateiSpeichern.test.ts`, `frontend/src/lagebesprechung/TerminPaneel.test.tsx`

**Interfaces:**
- Produces:
  - `export type ExportInhalt = 'personen' | 'tiere' | 'schaeden' | 'lagekarte' | 'lagebesprechung'`;
  - `export function exportDateiname(inhalt: ExportInhalt, einsatzId: number, endung = 'csv', jetzt = new Date()): string` (alle bestehenden Aufrufer prüfen, die `jetzt` positionsweise übergeben);
  - `export function fetchLagebesprechungIcs(einsatzId: number): Promise<Blob>` mit `apiDatei(\`/api/incidents/${einsatzId}/briefing/schedule/export\`)`.

- [x] **Step 1:** Failing Tests:
  - `exportDateiname('lagekarte', 42, 'kmz', new Date(2026,10,24,14,5))` === `'lagekarte-einsatz-42-2026-11-24-1405.kmz'`; der Aufruf ohne Endung bleibt `.csv`.
  - TerminPaneel:
    - `In Kalender übernehmen` ist gesperrt mit sichtbarem „Kein Termin“, wenn `stand.naechste_lagebesprechung_at` null ist;
    - mit Termin und `darfSchreiben=false` ist er aktiv;
    - ein Klick ruft `fetchLagebesprechungIcs` und `speichereDatei` mit `lagebesprechung-einsatz-…ics`;
    - ein Fehler zeigt „Keine Verbindung zum Server“ bzw. die Fehlermeldung am Paneel.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/components/dateiSpeichern.test.ts src/lagebesprechung/TerminPaneel.test.tsx` → FAIL.
- [x] **Step 3:** Umsetzen:
  - Knopf unter der Termingruppe, als Mutation mit `networkMode: 'always'` wie `useCsvExport`;
  - ein Fehler erscheint über `SpeicherFehler` mit dem Titel „Nicht übernommen“.
- [x] **Step 4:** Tests → PASS; `mise exec -- pnpm -C frontend exec tsc --noEmit -p .` → ok.
- [x] **Step 5:** Commit `feat: Lagebesprechungstermin in den Kalender übernehmen` (Zunder D).

### Task 6: Android öffnet Kalenderdateien

**Files:**
- Modify: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Linkweiche.kt` (`Downloadablage`)
- Modify: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/dienste/Downloads.kt` (`teilen`, :133-147)
- Test: `android/kern/src/test/…/LinkweicheTest.kt`

**Interfaces:**
- Produces:
  - `enum class Oeffnen { ANZEIGEN, TEILEN }`;
  - `fun Downloadablage.oeffnenAls(mimetyp: String, endung: String): Oeffnen` → `ANZEIGEN` für `text/calendar` oder Endung `ics` (Groß- und Kleinschreibung egal), sonst `TEILEN`.

- [x] **Step 1:** Failing Kern-Test `kalenderdatei_wird_angezeigt_sonst_geteilt`:
  - `("text/calendar","ics")` → ANZEIGEN;
  - `("application/octet-stream","ICS")` → ANZEIGEN;
  - `("text/csv","csv")` → TEILEN.
- [x] **Step 2:** `LC_ALL=C.UTF-8 android/gradlew -p android/kern test` → FAIL.
- [x] **Step 3:** Kernfunktion umsetzen.
  - In `teilen` bei ANZEIGEN `Intent(Intent.ACTION_VIEW).setDataAndType(adresse, "text/calendar")` mit `FLAG_GRANT_READ_URI_PERMISSION` im Chooser.
  - Fehlt eine Activity (`ActivityNotFoundException`), fällt es auf den bisherigen `ACTION_SEND` zurück.
- [x] **Step 4:** Kern-Tests → PASS.
  - Lässt sich `android/app` hier bauen (`LC_ALL=C.UTF-8 android/gradlew -p android :app:compileDebugKotlin`), ebenfalls → ok.
  - Sonst im Ledger vermerken: „App-Teil nicht gebaut: <Grund>“.
- [x] **Step 5:** Commit `feat(android): Kalenderdateien direkt öffnen` (Zunder D).

## Teil A — Export (LLH-2098)

### Task 7: Exportobjekte sammeln

**Files:**
- Create: `frontend/src/pages/lagekarte/geoExport.ts`, `frontend/src/pages/lagekarte/geoExport.test.ts`

**Interfaces:**
- Consumes:
  - `KarteMarker`, `MarkerTyp` (`marker.ts`);
  - `ZoneFeature` (`useLagekarteDaten.ts:521`, um die Warnstufe ergänzen, falls sie fehlt);
  - `kartenFlaechen: {id,label,polygon}[]`;
  - `markerZeichen` (`markerIcons.ts:18`);
  - `PALETTE` (`@einsatzzeichen/schema`).
- Produces:
  - `export type ExportArt = 'freies_zeichen'|'zone'|'gefahrengebiet'|'evakuierungsbezirk'|'schaden'|'uhs'|'betreuung'|'abschnitt'|'fahrzeug'|'einheit'|'einsatzort'|'fuehrungsstelle'|'bereitstellungsraum'|'sammelstelle'`;
  - `export interface ExportObjekt { art: ExportArt; name: string; beschriftung: string; warnstufe?: string; geometrie: GeoJSON.Geometry; zeichen?: { schluessel: string; spec: string; drawing: Drawing }; stil: { linie?: string; fuellung?: string; deckkraft?: number; markerFarbe?: string } }`;
  - `export interface ExportEingabe { marker: KarteMarker[]; flaechen: {id:number;label:string;polygon:GeoJSON.Polygon}[]; zonen: ZoneFeature[]; einsatzName: string; stand: Date }`;
  - `export function collectExportObjekte(eingabe: ExportEingabe): ExportObjekt[]`;
  - `export const EXPORT_MARKER_ARTEN: Partial<Record<MarkerTyp, ExportArt>>`.

- [x] **Step 1:** Failing Tests:
  - `jeder_markertyp_ist_entschieden`: Jeder Wert von `MarkerTyp` steht entweder in `EXPORT_MARKER_ARTEN` oder in `AUSGESCHLOSSEN = ['fuehrung','tier','lagemeldung','person']`, nie in beiden.
  - `personen_fuehrung_tier_meldung_fehlen`.
  - `keine_freitexte`: Ein Marker mit `beschriftungZusatz` bzw. `notiz` trägt nur den `label` als `name`.
  - `koordinaten_lon_lat_sechs_stellen`.
  - `zeichen_spec_aus_schluessel`: `ez|<spec>` → `spec`.
  - `gefahrengebiet_hat_warnstufe_und_feste_farbe`: `warnstufe` gesetzt, `beschriftung` enthält „Warnstufe“, `stil.linie` ist ein Hex-Wert und keine CSS-Variable.
  - `gedaempfte_abschnitte_bleiben`.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/pages/lagekarte/geoExport.test.ts` → FAIL.
- [x] **Step 3:** `collectExportObjekte` umsetzen.
  - Sichtbarkeit ist schon durch die Eingabe gefiltert, denn Aufrufer übergeben `sichtbareMarker`, `kartenFlaechen` und `zonenFeatures`.
  - Exportfarben der Gefahrengebiete als Konstante `GEFAHR_EXPORT_FARBE` mit den Tagestönen aus `zonenStil.ts:88-91`.
- [x] **Step 4:** Test → PASS.
- [x] **Step 5:** Commit `feat: Objekte der Lagekarte für den Export sammeln` (Zunder A).

### Task 8: GeoJSON schreiben

**Files:**
- Create: `frontend/src/pages/lagekarte/geojsonWriter.ts`, `…/geojsonWriter.test.ts`

**Interfaces:**
- Produces: `export function writeGeojson(objekte: ExportObjekt[], meta: { stand: Date; einsatzName: string }): string` (JSON-Text, `FeatureCollection`).

- [x] **Step 1:** Failing Tests:
  - Jedes Feature hat `properties.name`, `properties['lfh:art']`, und bei vorhandenem Zeichen `properties['lfh:zeichen']`.
  - Simplestyle-Felder `stroke`, `fill`, `fill-opacity` für Flächen und `marker-color` für Punkte.
  - Polygonringe geschlossen.
  - Wurzel: `lfh:stand` im UTC-Format `YYYY-MM-DD HH:MM:SS`, `lfh:quelle` = `'Lifeline Hub'`, kein `crs`.
  - Gefahrengebiet: `lfh:warnstufe`.
- [x] **Step 2:** vitest → FAIL. **Step 3:** umsetzen. **Step 4:** vitest → PASS.
- [x] **Step 5:** Commit `feat: Lagekarte als GeoJSON schreiben` (Zunder A).

### Task 9: KML schreiben, Zeichen rastern, KMZ packen

**Files:**
- Create:
  - `frontend/src/pages/lagekarte/kmlWriter.ts`, `…/kmlWriter.test.ts`;
  - `…/zeichenPng.ts`;
  - `…/kmzPacker.ts`, `…/kmzPacker.test.ts`.
- Modify: `frontend/package.json` (`fflate`, aktuelle Version, Lockfile mit)

**Interfaces:**
- Produces:
  - `export function writeKml(objekte: ExportObjekt[], meta: { stand: Date; einsatzName: string }, iconPfad: (schluessel: string) => string): string`;
  - `export function iconDateiname(schluessel: string): string` → `files/<fnv1a-hex>.png`;
  - `export async function renderZeichenPng(drawing: Drawing, groesse = 64): Promise<Blob>` (Canvas mit `renderCanvas` aus `@einsatzzeichen/core` ohne Theme, vorher `document.fonts.load` für die Zeichenschrift);
  - `export async function packKmz(objekte: ExportObjekt[], meta, render = renderZeichenPng): Promise<Blob>` mit `doc.kml` zuerst, PNGs `level: 0`, MIME `application/vnd.google-earth.kmz`.

- [x] **Step 1:** Failing Tests:
  - KML: Wurzel `<kml xmlns="http://www.opengis.net/kml/2.2">`; `Document/name` mit Einsatzname; ein `Style` je Zeichenschlüssel mit `IconStyle/Icon/href` = `files/….png`; ein `Folder` je Art.
  - Farbe `#ff0000` mit Deckkraft 0.5 → `7f0000ff` (aabbggrr).
  - Texte mit `<&>"'` werden escaped.
  - Keine `description`.
  - Kreis- bzw. Polygonzonen als `Polygon/outerBoundaryIs`.
  - KMZ mit Stub-Renderer: `unzipSync` liefert als ersten Eintrag `doc.kml` und je Zeichenschlüssel genau ein PNG; zweimal derselbe Schlüssel ergibt ein PNG.
- [x] **Step 2:** vitest → FAIL. **Step 3:** umsetzen (`renderZeichenPng` nicht in Unit-Tests, jsdom hat kein Canvas). **Step 4:** vitest → PASS.
- [x] **Step 5:** Commit `feat: Lagekarte als KMZ mit Zeichen schreiben` (Zunder A).

### Task 10: Exporteinträge in der Lagekarte

**Files:**
- Create: `frontend/src/pages/lagekarte/useGeoExport.ts`, `…/useGeoExport.test.tsx`
- Modify: `frontend/src/pages/LagekartePage.tsx` (Nebenwege :1481-1505)
- Modify: Anwenderdoku Kapitel Lagekarte unter `docs/anwender/` (Abschnitt „Lagekarte exportieren“, Kapitelform nach `docs/anwender/AGENTS.md`)

**Interfaces:**
- Consumes: `collectExportObjekte`, `writeGeojson`, `packKmz`, `exportDateiname`, `speichereDatei`.
- Produces: `export function useGeoExport(eingabe: ExportEingabe | null): { nebenwege: Nebenweg[]; fehler: Error | null }` mit den Schlüsseln `export-kmz` und `export-geojson`; bei leerer Objektliste `gesperrt: true` und Label-Zusatz „(Nichts eingeblendet)“.

- [x] **Step 1:** Failing Tests:
  - Zwei Einträge mit den Labels `Exportieren: Google Earth (KMZ)` und `Exportieren: GIS (GeoJSON)`.
  - Leer → beide gesperrt.
  - GeoJSON-Wahl ruft `speichereDatei` mit einem Blob vom Typ `application/geo+json` und dem Namen `lagekarte-einsatz-<id>-….geojson`.
- [x] **Step 2:** vitest → FAIL. **Step 3:** umsetzen und in `nebenwege` vor der Anlage einhängen; ein Fehler geht als Seitenfehler an die Seite (vorhandenes Fehlerband der Lagekarte). **Step 4:** vitest → PASS; `tsc --noEmit` ok.
- [x] **Step 5:** Commit `feat: Lagekarte exportieren` (Zunder A).

## Teil B — Fremdebene aus Datei (LLH-2099)

### Task 11: Tabellen, Registrierung, Einlesen GeoJSON und Prüfung

**Files:**
- Create: `migrations/0373_karte_fremdebene.sql` (Nummer prüfen); `src/karte_fremdebene/{mod.rs,repo.rs,einlesen/mod.rs,einlesen/geojson.rs,einlesen/pruefen.rs}`
- Modify: `src/lib.rs`; `src/instanz/spiegel/art.rs` (Metadaten `K::Lage`, Daten `K::Anhaenge`); `src/instanz/spiegel/uebernehmen.rs` (wie :1087); `src/einsatz/schwaerzung_registry.rs` (`TabellenRegel` für beide Tabellen; `name` und `url` `scrub(…, Strategie::Platzhalter, Z_EINSATZ)`, Daten `Scoping::UeberParent { fk: "ebene_id", parent: "karte_fremdebene" }`); `src/einsatz/schwaerzung_nachlauf.rs`, `src/einsatz/archiv/tests.rs`, `src/db/tests.rs`, `src/karten_ansicht/repo.rs` (wo die Wächter es verlangen); `src/error.rs`; `tests/enum_wire_kontrakt.rs`

**Interfaces:**
- Tabellen genau wie im Spec, „Daten“.
- Produces:
  - `wire_enum! FremdebeneQuelle { Datei => "datei", Url => "url" }`;
  - `wire_enum! FremdebeneFehler { Unlesbar => "unlesbar", Dtd => "dtd", ZuGross => "zu_gross", ZuVieleObjekte => "zu_viele_objekte", Leer => "leer", Koordinaten => "koordinaten", Virus => "virus", NichtErreichbar => "nicht_erreichbar", Weiterleitung => "weiterleitung", Abgelehnt => "abgelehnt", Status => "status", ZielIntern => "ziel_intern", Zeitlimit => "zeitlimit" }`;
  - `AppError::Fremdebene(FremdebeneFehler)` → 400 bzw. 413 bei `ZuGross`, mit `{"error": <Meldung>, "grund": <code>}`, Meldungen wörtlich aus dem Spec-Abschnitt „Fehler“;
  - `pub struct Normiert { pub geojson: String, pub objekte: i64, pub verworfen: i64, pub namensvorschlag: Option<String> }`;
  - `pub fn read_datei(bytes: &[u8]) -> Result<Normiert, FremdebeneFehler>` (Formaterkennung am Inhalt; KML und KMZ liefern bis Task 12 `Unlesbar`);
  - `pub fn normalize_geometrie(v: &serde_json::Value, zaehler: &mut Grenzen) -> Result<Option<serde_json::Value>, FremdebeneFehler>`;
  - Repo: `liste(pool, einsatz_id) -> Vec<FremdebeneAnzeige>`, `anlegen(pool, einsatz_id, angelegt_von, name, quelle, url: Option<&str>, farbe, normiert) -> FremdebeneAnzeige`, `laden_daten(pool, einsatz_id, id) -> Option<(String /*geojson*/, String /*sha256*/)>`, `aktualisiere(pool, einsatz_id, id, patch)`, `loeschen(pool, einsatz_id, id)`, `ersetze_daten(...)`, `setze_abruf(...)`;
  - `FremdebeneAnzeige` mit den Wire-Feldern `id, name, source, url: Option<String>, url_host: Option<String>, color, feature_count, dropped_count, fetched_at, attempted_at, error: Option<FremdebeneFehler>, created_at`.

- [x] **Step 1:** Failing Tests:
  - Einlesen: `geojson_featurecollection_wird_normiert` (nur `name` und `description`, 6 Stellen); `nackte_geometrie_und_geometrycollection`; `mercator_meter_sind_koordinatenfehler` (lon 1 113 194 → `Koordinaten`); `objekt_ohne_geometrie_wird_gezaehlt`; `zu_viele_objekte`; `zu_viele_stuetzpunkte_je_ring`; `leere_datei_ist_leer`; `html_in_description_wird_text`.
  - Registry: `cargo test --lib schwaerzung_registry spiegel::art` grün.
- [x] **Step 2:** `cargo test --lib karte_fremdebene` → FAIL.
- [x] **Step 3:** Migration, Modul, Registrierungen und Fehlervariante umsetzen; die Bereichsprüfung als eigene Funktion in `einlesen/pruefen.rs`.
- [x] **Step 4:** Prüfen:
  - `cargo test --lib karte_fremdebene schwaerzung_registry spiegel einsatz::archiv db::tests` → PASS;
  - `cargo test --test enum_wire_kontrakt` → PASS;
  - `scripts/check-migrationen.sh` → grün.
- [x] **Step 5:** Commit `feat: Fremdebenen speichern und GeoJSON einlesen` (Zunder B).

### Task 12: KML und KMZ einlesen

**Files:**
- Create: `src/karte_fremdebene/einlesen/kml.rs`, `…/kmz.rs`
- Modify: `Cargo.toml` (`quick-xml` direkt, dieselbe Major-Version wie im Lockfile)

**Interfaces:**
- Produces:
  - `pub fn read_kml(text: &str, grenzen: &mut Grenzen) -> Result<Normiert, FremdebeneFehler>`;
  - `pub fn read_kmz(bytes: &[u8], grenzen: &mut Grenzen) -> Result<Normiert, FremdebeneFehler>`.
  - `read_datei` verzweigt darauf.

- [x] **Step 1:** Failing Tests:
  - `placemarks_punkt_linie_flaeche_multigeometry`;
  - `gx_track_wird_linie`;
  - `hoehe_wird_verworfen`;
  - `document_name_ist_vorschlag`;
  - `doctype_wird_abgelehnt` (Billion Laughs und `SYSTEM "file:///etc/passwd"` → `Dtd`);
  - `networklink_und_href_werden_nicht_verfolgt` (Ergebnis enthält nur die Placemarks, keine Netzanfrage, kein Fehler);
  - `kmz_nimmt_doc_kml_sonst_erste_kml`;
  - `kmz_bombe_ist_zu_gross` (Eintrag mit kleinem Kopf, entpackt > 20 MiB → `ZuGross`, beim Lesen begrenzt über `take`);
  - `kmz_ohne_kml_ist_unlesbar`.
- [x] **Step 2:** `cargo test --lib karte_fremdebene::einlesen` → FAIL.
- [x] **Step 3:** `quick_xml::Reader` mit `Event::DocType` → `Dtd`, Entity-Referenzen nicht auflösen (unbekannte → `Unlesbar`), `zip::ZipArchive` mit gedeckeltem `Read::take`.
- [x] **Step 4:** → PASS.
- [x] **Step 5:** Commit `feat: Fremdebenen aus KML und KMZ einlesen` (Zunder B).

### Task 13: Routen für Datei-Fremdebenen und Live-Ereignis

**Files:**
- Create: `src/routes/karte_fremdebene.rs`; `tests/karte_fremdebene.rs`
- Modify: `src/routes/mod.rs`; `src/app.rs` (neben den Hintergrundbildern, Upload mit `DefaultBodyLimit::max(UPLOAD_BODY_MAX)` und `upload_grenze`, Daten mit `download_grenze()`); `src/live/mod.rs` (`KarteFremdebene => "karte_fremdebene"`, Module `&["lagekarte"]`); `tests/zulassung_guard.rs` (falls verlangt)

**Interfaces:**
- Routen wie im Spec unter `/api/incidents/{id}/map/foreign-layers`.
- Upload als multipart mit den Feldern `name`, `file` oder `url` (genau eines, sonst 400) und optional `color`; die Farbe vergibt sonst der Server (erster freier Palettenschlüssel `fremd-1` … `fremd-6`).
- Produces:
  - `liste`, `anlegen`, `daten`, `aktualisieren`, `loeschen`;
  - `daten` antwortet mit `ETag` = `"<sha256>"`, 304 über `support::if_none_match_matcht`, `Content-Type: application/geo+json`, ungepackt.
  - `url` nur bei Schreibrecht, sonst `None` und `url_host` gesetzt.

- [x] **Step 1:** Failing Tests:
  - Hochladen, Liste, Daten, 304 mit `If-None-Match`, PATCH `name`/`color`, DELETE;
  - 403 beim Hochladen als Beobachter, Lesen als Beobachter ok;
  - ungültige Datei → 400 mit `grund: "unlesbar"`, DTD → `grund: "dtd"`, über 10 MiB → 413;
  - ein Virus-Stub ist abgelehnt (wie die Tests der Hintergrundbilder mit `scan_config`);
  - ein Live-Ereignis `karte_fremdebene` nach dem Anlegen.
- [x] **Step 2:** `cargo test --test karte_fremdebene` → FAIL.
- [x] **Step 3:** Umsetzen in der Reihenfolge Größe → Einlesen → `anhang::scan` → speichern → Live. `scripts/check-typ-codegen.sh` schreibt die Typen.
- [x] **Step 4:** Prüfen:
  - `cargo test --test karte_fremdebene --test einsatz_kontext_guard --test zulassung_guard --test enum_wire_kontrakt` → PASS;
  - `scripts/check-api-routen.sh` und `scripts/check-typ-codegen.sh` → grün.
- [x] **Step 5:** Commit `feat: Routen für Fremdebenen aus Datei` (Zunder B), mit den generierten Typen.

## Teil C — Fremdebene aus URL (LLH-2100)

### Task 14: Org-Schalter für LAN-Ziele

**Files:**
- Create: `migrations/0374_org_fremdebenen_lan.sql`
- Modify: `src/org/einstellungen.rs` (Spalte `fremdebenen_lan_erlaubt`); `src/routes/org_einstellungen.rs`; `src/auth/admin_audit.rs` (`FremdebenenLanErlaubt`/`FremdebenenLanEntzogen`, `Ziel` um eine Org-Variante erweitern, falls nötig); Frontend-Verwaltung der Org-Einstellungen (Schalter „Fremdebenen dürfen das eigene Netz abrufen“)
- Test: bestehender Test der Org-Einstellungen erweitert

**Interfaces:**
- Produces:
  - Wire-Feld `foreign_layers_lan_allowed: Option<bool>` im DTO der Org-Einstellungen (folgt der Sprache des bestehenden Typs: ist der deutsch, dann `fremdebenen_lan_erlaubt`);
  - `pub async fn is_fremdebenen_lan_erlaubt(pool, org_id) -> Result<bool, AppError>`.
  - Nur ein Admin darf setzen; eine Änderung schreibt einen Admin-Spur-Eintrag.

- [x] **Step 1:** Failing Tests:
  - Standard `false`;
  - der Admin setzt `true` → Lesen ergibt `true`, die Admin-Spur trägt `fremdebenen_lan_erlaubt`;
  - ein Nicht-Admin bekommt 403;
  - Frontend: Schalter sichtbar und an die Mutation gebunden.
- [x] **Step 2:** → FAIL. **Step 3:** umsetzen. **Step 4:** Tests, Enum-Kontrakt, Typ-Codegen → PASS.
- [x] **Step 5:** Commit `feat: Org-Schalter für Fremdebenen im eigenen Netz` (Zunder C).

### Task 15: URL-Abruf beim Lesen

**Files:**
- Modify: `src/adapter/ziel.rs` (neuer öffentlicher Helfer); `src/karte_fremdebene/abruf.rs` (neu); `src/routes/karte_fremdebene.rs` (`anlegen` mit `url`, `daten` mit Nachholen); `src/AGENTS.md` (Satz im Abschnitt Adapter: „Die Fremdebene (LLH-2100) ruft über `adapter::ziel::fetch_bedingt` ab.“)
- Test: `tests/karte_fremdebene_url.rs`. Den lokalen https-Testserver und den Testzugang am Zielschutz vorbei so aufbauen wie die bestehenden Adapter-Tests (`tests/adapter*`; dort nachsehen, wie sie ein lokales Ziel erreichen).

**Interfaces:**
- Produces:
  - `pub struct BedingteAntwort { pub status: u16, pub etag: Option<String>, pub last_modified: Option<String>, pub body: Option<Vec<u8>> }`;
  - `pub async fn fetch_bedingt(url: &str, lan_erlaubt: bool, deckel: usize, etag: Option<&str>, last_modified: Option<&str>) -> Result<BedingteAntwort, FremdebeneFehler>`, in `adapter::ziel`, nutzt `check_url` und den privaten `client(lan_erlaubt)`;
  - `pub async fn refresh_if_due(state: &AppState, einsatz_id: i64, ebene_id: i64) -> Result<(), AppError>` in `karte_fremdebene::abruf`:
    - Single-Flight je `ebene_id` (prozessweite `Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>`);
    - holt nur, wenn `versucht_at` älter als 60 s ist, die Quelle `url` ist, der Einsatz nicht abgeschlossen bzw. gesperrt ist und hier geführt wird (kein Spiegel, `einsatz.spiegel`).
- Die URL erscheint nie in `tracing`, Fehlertext oder Admin-Spur.

- [x] **Step 1:** Failing Tests:
  - `anlegen_mit_url_holt_sofort` (200 → Daten da; Tippfehler bzw. 404 → 400 mit `grund: "status"`);
  - `etag_304_aendert_nur_fetched_at`;
  - `neuer_inhalt_ersetzt_und_sendet_live`;
  - `fehler_behaelt_letzten_stand` (500 → `error: "status"`, Daten unverändert);
  - `weiterleitung_wird_nicht_verfolgt` (302 → `weiterleitung`);
  - `http_ohne_s_abgelehnt`;
  - `lan_ziel_nur_mit_org_schalter` (`ziel_intern` ohne Schalter);
  - `binnen_60_s_kein_zweiter_abruf`;
  - `gleichzeitige_leser_ein_abruf` (zwei parallele `GET …/data` → der Testserver zählt 1);
  - `spiegel_und_abgeschlossen_holen_nicht`;
  - `beobachter_sieht_nur_url_host`.
- [x] **Step 2:** `cargo test --test karte_fremdebene_url` → FAIL.
- [x] **Step 3:** umsetzen.
- [x] **Step 4:** Tests → PASS; `cargo test --lib adapter` → PASS.
- [x] **Step 5:** Commit `feat: Fremdebenen aus URL, bedingt nachgeholt` (Zunder C).

## Teil B+C — Frontend

### Task 16: API, Keys, Offline, Grenzen

**Files:**
- Create: `frontend/src/api/fremdebenen.ts`, `…/fremdebenen.test.ts`
- Modify: `frontend/src/api/queryKeys.ts` (`EINSATZ_KEYS.fremdebenen: 'einsatz-fremdebenen'`, `fremdebeneDaten: 'einsatz-fremdebene-daten'`; `EINSATZ_STREAM_EVENTS.karte_fremdebene: [beide]`; beide in `LAGEBILD_OFFLINE`; `einsatzKeys.fremdebenen(id)`, `einsatzKeys.fremdebeneDaten(id, ebeneId)`); `frontend/src/api/eingabegrenzen.ts`

**Interfaces:**
- Produces:
  - `type Fremdebene = components['schemas']['FremdebeneAnzeige']`;
  - `listeFremdebenen(einsatzId): Promise<Fremdebene[]>`;
  - `ladeFremdebeneDaten(einsatzId, ebeneId): Promise<GeoJSON.FeatureCollection>`;
  - `legeFremdebeneAn(einsatzId, eingabe: { name: string; datei?: File; url?: string }, onFortschritt?)` (über `apiUploadMitFortschritt`);
  - `aktualisiereFremdebene(einsatzId, ebeneId, patch: { name?: string; color?: string })`;
  - `loescheFremdebene(einsatzId, ebeneId)`;
  - `FREMDEBENE_GRENZEN = { dateiBytes: 10 * 1024 * 1024, nameMax: 120 }`;
  - `FREMDEBENE_FEHLERTEXT: Record<FremdebeneFehler, string>`, wortgleich mit dem Server.

- [x] **Step 1:** Failing Tests:
  - Die Pfade lauten `/api/incidents/<id>/map/foreign-layers…`;
  - FormData trägt genau `file` bzw. `url`;
  - `lagebildOffline.guard.test.ts` und der Guard für die Live-Klassifikation sind grün mit den neuen Keys.
- [x] **Step 2:** vitest → FAIL. **Step 3:** umsetzen. **Step 4:** vitest (inklusive der Guards) → PASS.
- [x] **Step 5:** Commit `feat: Frontend-API für Fremdebenen` (Zunder B).

### Task 17: Ebene zeichnen, Baumgruppe, Detailkarte

**Files:**
- Create: `frontend/src/pages/lagekarte/fremdebenenLayer.ts`, `…/fremdebenenLayer.test.ts`, `…/FremdebenenZeilen.tsx`, `…/FremdebenenZeilen.test.tsx`, `frontend/src/pages/lagekarte/useFremdebenen.ts`
- Modify: `frontend/src/theme/` (Farbvertrag: `FREMDEBENEN_PALETTE` mit sechs Tönen, Schlüssel `fremd-1` … `fremd-6`, je ein Wert für hell und dunkel); `pages/lagekarte/leistenDaten.ts` (`BaumKnoten` um `'fremdebenen'`, `BAUM_KLAPP_VORGABE.fremdebenen: true`); `Ebenenbaum.tsx` (Gruppe „Fremdebenen“ neben „Bilder“); `LagekartePage.tsx`; Sichtbarkeit je Ebene über `lib/sichererSpeicher` und Eintrag in `GERAETESPEICHER`; `LageplanDruck`-Legende

**Interfaces:**
- Consumes: Task 16; `sorgeFuerFachebeneLayer`/`setzeFachebeneDaten` bzw. deren Mischgeometrie-Pfad; `wendeKartenDatenAn(map, \`fremdebene-${id}\`, …)`.
- Produces:
  - `export function sorgeFuerFremdebeneLayer(map: MapLibreMap, ebeneId: number, daten: FeatureCollection, farbe: string): void`;
  - `export function entferneFremdebeneLayer(map, ebeneId): void`;
  - Layer-IDs `fremdebene-<id>-flaeche|linie|punkt|text`, eingefügt vor dem ersten eigenen Lage-Layer;
  - `useFremdebenen(einsatzId)` mit Liste, sichtbaren IDs, `toggle(id)` und Daten-Queries; für URL-Ebenen `refetchInterval: 60_000`, nur wenn sichtbar und `document.visibilityState === 'visible'`.

- [x] **Step 1:** Failing Tests:
  - Layer: vier Layer mit der Ebenenfarbe, das Entfernen räumt alle auf, das Neuanlegen nach Stilwechsel klappt (`reAnlegenAlles`-Weg).
  - Zeilen:
    - `role="switch"` mit dem Namen;
    - eine URL-Ebene zeigt „vor 3 min“;
    - mit `error` zeigt sie den Warnhinweis mit dem Text aus `FREMDEBENE_FEHLERTEXT`;
    - das ⋮-Menü hat „Umbenennen“, „Farbe“, „Entfernen“ (nicht rot), nur mit Schreibrecht.
  - Legende: Eine sichtbare Fremdebene erscheint mit Name und Farbe.
- [x] **Step 2:** vitest → FAIL. **Step 3:** umsetzen; ein Klick auf ein Objekt öffnet `KartenDetailCard` nur zum Lesen mit `name`, `description`, Ebenenname und „Fremde Daten“. **Step 4:** vitest → PASS; `tsc --noEmit` ok.
- [x] **Step 5:** Commit `feat: Fremdebenen auf der Lagekarte zeigen` (Zunder B).

### Task 18: Dialog „Fremdebene hinzufügen“

**Files:**
- Create: `frontend/src/pages/lagekarte/FremdebeneDialog.tsx`, `…/FremdebeneDialog.test.tsx`
- Modify: `LagekartePage.tsx` (Nebenweg `fremdebene` „Fremdebene hinzufügen …“ nur mit Schreibrecht über `einsatz/schreibrecht.ts`, gesperrt ohne Netz)

**Interfaces:**
- Consumes: `legeFremdebeneAn`, `FREMDEBENE_GRENZEN`, `FREMDEBENE_FEHLERTEXT`, `DateiFeld`.

- [x] **Step 1:** Failing Tests:
  - Die Wahl „Datei“ bzw. „Adresse“ schaltet das Feld um.
  - Der Name wird aus dem Dateinamen ohne Endung vorbelegt.
  - Eine Datei über 10 MB wird vor dem Senden abgelehnt.
  - Eine Adresse ohne `https://` ist ungültig.
  - Ein Serverfehler `dtd` zeigt den Text im Dialog, und der Dialog bleibt offen.
  - Erfolg schließt den Dialog und macht die Liste ungültig.
- [x] **Step 2:** vitest → FAIL. **Step 3:** umsetzen. **Step 4:** vitest → PASS.
- [x] **Step 5:** Commit `feat: Fremdebene hinzufügen` (Zunder B).

## Abschluss

### Task 19: Doku

**Files:**
- Modify:
  - Anwenderdoku: Kapitel Lagekarte („Fremdebenen“, „Lagekarte exportieren“ falls nicht in Task 10) und Lagebesprechung („Termin in den Kalender übernehmen“) unter `docs/anwender/`, die `quellen:` des Kapitels ergänzt;
  - arc42 unter `docs/architektur/`: Kapitel 5 (Modul `karte_fremdebene`), Kapitel 6 (Abruf beim Lesen), Kapitel 11 (Risiko fremde URL bzw. fremde Datei), Kapitel 12 (Begriff „Fremdebene“).
- Create: Folgeaufgaben vermerken (im PR-Text, nicht im Code): iOS-Kalender, GPX, „Objekt übernehmen“, Fremdebenen im Snapshot.

- [x] **Step 1:** Doku schreiben.
- [x] **Step 2:** Doku-Wächter (Teil von `check-all.sh`) → grün.
- [x] **Step 3:** Commit `docs: Fremdebenen, Export und Kalender in Anwender- und Architekturdoku`.

### Task 20: Gate

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → alle Schritte grün; jeden roten Schritt an der Ursache beheben, nichts abschalten.
- [x] **Step 2:** Commit etwaiger Nacharbeiten.
