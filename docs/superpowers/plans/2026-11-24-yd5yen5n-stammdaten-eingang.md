# Stammdaten-Eingang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fahrzeuge, Personal und Qualifikationen einer Org aus einer CSV/XLSX-Datei mit Vorschau übernehmen und über Kennung + Herkunft wiederfinden.

**Architecture:** Ein Dateileser macht aus der Datei ein `StammdatenPaket`; ein reiner Abgleich (`abgleich.rs`) ordnet jede Zeile einem Bestand zu; `repo::vorschau` schreibt nichts, `repo::uebernehmen` schreibt in einer Transaktion. Kennungen liegen in der neuen Tabelle `stammdaten_kennung`. Muster: LLH-1556 (`src/abloesung/schichtplan/uebernahme/`).

**Tech Stack:** Rust (axum, sqlx/SQLite, calamine, utoipa), React + antd + react-query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-yd5yen5n-stammdaten-eingang-design.md` (freigegeben 24.11.2026). Executor liest beide.

Zunder: https://zunder.rubeen.dev/#/aufgabe/yd5yen5n87qfzohu8asp4k9t (gehört in jeden Commit-Body).

## Global Constraints

- Kein Herstellername (insbesondere nicht der Name der liefernden Fahrzeug- oder Mitgliederverwaltung) in Code, Migration, Enum, OpenAPI oder Oberflächentext. Docs dürfen Beispiele neutral nennen („Fahrzeugverwaltung“).
- Grenzen: Datei 2 MiB, 5000 Zeilen **je Art**, entpackte XLSX 64 MiB, `kennung`/`herkunft` je ≤ 100 Zeichen (Werte aus `uebernahme::mod`, nicht neu erfinden).
- Spalten des Vertrags nur wie im Spec; jede andere Spalte wird nicht gelesen, nur ihr Kopf erscheint in `nicht_uebernommen`.
- Leere Zelle = keine Angabe, nie „leeren“.
- Nur Datensätze der eigenen Org und `dienststatus = 'in_dienst'` werden gefunden; Treffer außer Dienst → Zeile ausgelassen mit Hinweis.
- Erkennungsfelder (Fahrzeug `funkrufname`/`opta`/`fms_issi`, Personal `name`/`personalnummer`) nur bei Treffer über Kennung+Herkunft änderbar.
- Rechte `AdminUser` (wie `POST /api/vehicles`); Org meldet sich bei einem Hub (`public_api::zugang::hub_fuer_org(..).is_some()`) → 409.
- Migration: nächste freie Nummer gegen `origin/alpha` (heute 0373), `scripts/check-migrationen.sh`; Kopfkommentar mit LLH-1633; nur anhängen.
- Nach DTO-Änderung: `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts` mit committen.
- Ein Commit je Task, Typ `feat`/`refactor`/`test`/`docs` passend, Body mit Zunder-Zeile.

## Review Focus

1. **Dieselbe Datei zweimal** → zweiter Lauf: Vorschau zählt 0 neu, 0 Änderungen; Übernehmen schreibt nichts (Test in Task 5).
2. **Org-Isolation:** Kennung/OPTA/Personalnummer einer fremden Org wird nie getroffen, auch nicht über `stammdaten_kennung` (Test in Task 5).
3. **Umbenennung kollidiert** mit anderem Fahrzeug im Dienst (Funkrufname-Unique) → `fehler` in der Vorschau, kein 500 beim Übernehmen (Test in Task 5).
4. **Personalzeile mit unbekannter Qualifikation ohne Entscheidung** → Standard „neu anlegen“; mit „zuordnen“ wird die Zuordnung gemerkt und greift im nächsten Lauf ohne Entscheidung (Test in Task 5).
5. **Datei mit IBAN-/Geburtsdatum-Spalte** → Werte landen in keiner Tabelle und in keiner Antwort, nur der Kopf in `nicht_uebernommen` (Test in Task 3 und 6).

---

### Task 1: Migration `stammdaten_kennung`

**Files:**
- Create: `migrations/0373_stammdaten_kennung.sql`
- Modify: `src/db/tests.rs` (neuer Test am Ende des Migrations-Blocks)

**Interfaces:**
- Produces: Tabelle `stammdaten_kennung(id, org_id, herkunft, kennung, fahrzeug_id, personal_id, qualifikation_id, angelegt_at)` mit den Indizes aus dem Spec, Abschnitt „Datenmodell“: drei `uq_stammdaten_kennung_{fz,p,q}` auf `(org_id, herkunft, kennung)` und zwei Ziel-Indizes `uq_stammdaten_kennung_{fz,p}_ziel` auf `(herkunft, <ziel>_id)` (keiner für Qualifikationen). FK `org_id → organisation(id)`, Ziele `ON DELETE CASCADE`, CHECK genau ein Ziel.

- [ ] **Step 1: Test `migration_0373_stammdaten_kennung`** — prüft: (a) Insert mit zwei Zielen schlägt am CHECK fehl; (b) zweite Zeile gleiche Org/Herkunft/Kennung/Art → Unique-Fehler; (c) gleiche Kennung für Fahrzeug und Personal erlaubt; (d) zweite Kennung derselben Herkunft am selben Fahrzeug → Fehler, an derselben Qualifikation → erlaubt; (e) `DELETE FROM fahrzeug` löscht die Kennungszeile.
- [ ] **Step 2:** `cargo test --lib db::tests::migration_0373` → FAIL (Tabelle fehlt).
- [ ] **Step 3:** Migration schreiben (Kopfkommentar: Zweck, LLH-1633, Verweis auf Spec, „nicht verteilt“).
- [ ] **Step 4:** Test → PASS; `scripts/check-migrationen.sh` → grün.
- [ ] **Step 5:** Commit `feat(stammdaten): Tabelle stammdaten_kennung für Kennung + Herkunft`.

### Task 2: Gemeinsamer Dateileser `src/einlesen/`

**Files:**
- Create: `src/einlesen/mod.rs`, `src/einlesen/tabelle.rs` (aus `uebernahme/datei.rs`: `Tabelle`, `Zelle`, `lies_tabelle` und ihre privaten Helfer), `src/einlesen/namen.rs` (aus `uebernahme/abgleich.rs`: `norm`, `telefon_norm`, `namensformen`, `name_passt`, `herkunft_norm`)
- Modify: `src/lib.rs` (`pub mod einlesen;`), `src/abloesung/schichtplan/uebernahme/{datei,abgleich}.rs` (re-export per `pub use crate::einlesen::…`, damit alle bestehenden Pfade bleiben)

**Interfaces:**
- Produces:
  - `einlesen::tabelle::lies_tabelle(bytes: &[u8]) -> Result<Tabelle, AppError>` (Verhalten unverändert)
  - `einlesen::tabelle::lies_blaetter(bytes: &[u8], zeilen_max: usize) -> Result<Vec<(String, Tabelle)>, AppError>` — XLSX: alle Blätter mit Namen in Mappen-Reihenfolge; CSV: ein Eintrag mit Namen `""`. `zeilen_max` gilt je Blatt. Größen- und Zip-Grenzen wie `lies_tabelle`.
  - `einlesen::namen::{norm, telefon_norm, namensformen, name_passt, herkunft_norm}` (Signaturen unverändert)

- [ ] **Step 1: Tests in `tabelle.rs`**: `lies_blaetter_xlsx_mehrere_blaetter` (Mappe mit `Fahrzeuge` und `Personal` via `rust_xlsxwriter` → 2 Einträge, Namen und Kopf korrekt), `lies_blaetter_grenze_je_blatt` (2 Blätter à 3 Zeilen, `zeilen_max = 3` → ok; 4 Zeilen in einem → `Validation`), `lies_blaetter_csv_ein_eintrag`.
- [ ] **Step 2:** `cargo test --lib einlesen` → FAIL.
- [ ] **Step 3:** Verschieben (reines Move + `pub use`), dann `lies_blaetter` ergänzen; `lies_tabelle` darf intern darauf aufsetzen, solange ihr Verhalten („Austausch“, sonst erstes Blatt; Grenze über die Tabelle) gleich bleibt.
- [ ] **Step 4:** `cargo test --lib einlesen abloesung::schichtplan` und `cargo test --test schichtplan_import` → PASS, ohne geänderte Tests.
- [ ] **Step 5:** Commit `refactor(einlesen): Dateileser und Namens-Helfer aus der Schichtplan-Übernahme lösen`.

### Task 3: Typen und Datei → Paket (`src/stammdaten_eingang/`)

**Files:**
- Create: `src/stammdaten_eingang/mod.rs`, `src/stammdaten_eingang/datei.rs`
- Modify: `src/lib.rs`

**Interfaces:**
- Consumes: `einlesen::tabelle::lies_blaetter`, Grenzen aus `abloesung::schichtplan::uebernahme::{DATEI_MAX_BYTES, ZEILEN_MAX, KENNUNG_MAX, HERKUNFT_MAX}`.
- Produces (in `mod.rs`, alle `ToSchema` wo sie über die Leitung gehen):
  - `wire_enum! StammdatenArt { Fahrzeug => "fahrzeug", Personal => "personal", Qualifikation => "qualifikation" }`
  - `struct Herkunftsangabe { kennung: Option<String>, herkunft: Option<String> }` (roh aus der Datei)
  - `struct FahrzeugAngabe { zeile: u32, quelle: Herkunftsangabe, funkrufname: String, kennzeichen, opta, issi, typ, standort: Option<String> }`
  - `struct PersonalAngabe { zeile: u32, quelle: Herkunftsangabe, name: String, personalnummer, telefon, traegerorganisation: Option<String>, qualifikationen: Vec<String> }`
  - `struct QualifikationAngabe { zeile: u32, quelle: Herkunftsangabe, bezeichnung: String }`
  - `struct StammdatenPaket { fahrzeuge: Vec<FahrzeugAngabe>, personal: Vec<PersonalAngabe>, qualifikationen: Vec<QualifikationAngabe> }`
  - `struct DateiMeldung { art: Option<StammdatenArt>, zeile: Option<u32>, text: String }`
  - `datei::lies_paket(bytes: &[u8]) -> Result<(StammdatenPaket, Vec<DateiMeldung>, Vec<String> /* nicht_uebernommen */), AppError>`

- [ ] **Step 1: Tests in `datei.rs`:**
  - `csv_fahrzeuge_erkannt` — Kopf `Funkrufname;OPTA;ISSI;Kennung` → 1 Fahrzeug, `issi` gesetzt, `kennung` gesetzt.
  - `csv_art_mehrdeutig_400` — Kopf ohne `funkrufname`, `name`, `bezeichnung` → `Validation`.
  - `xlsx_blaetter_nach_namen` — Blätter `fahrzeuge` (klein), `Personal`, `Sonstiges` → Fahrzeuge + Personal gelesen, `Sonstiges` als Meldung „Blatt nicht gelesen“.
  - `unbekannte_spalten_nur_kopf` — Personal mit `IBAN`, `Geburtsdatum` → `nicht_uebernommen == ["IBAN","Geburtsdatum"]`, kein Wert davon im Paket (Debug-String des Pakets enthält die Zellwerte nicht).
  - `qualifikationen_liste` — Zelle `"San-A; SanH ;;"` → `["San-A","SanH"]`.
  - `pflichtspalte_leer_meldung` — Fahrzeugzeile ohne Funkrufname → Zeile fehlt im Paket, Meldung mit Zeilennummer.
  - `kennung_zu_lang_meldung` — 101 Zeichen → Meldung, Zeile fehlt.
- [ ] **Step 2:** `cargo test --lib stammdaten_eingang::datei` → FAIL.
- [ ] **Step 3:** Implementieren. Spaltenköpfe: trimmen, Kleinschreibung, Leerzeichen/`_`/`-` gleich behandeln. Arterkennung CSV wie Spec.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(stammdaten): Datei des Vertrags Stammdaten-Datei lesen`.

### Task 4: Abgleich (rein, ohne Datenbank)

**Files:**
- Create: `src/stammdaten_eingang/abgleich.rs`

**Interfaces:**
- Consumes: Typen aus Task 3, `einlesen::namen::*`.
- Produces:
  - Bestand: `struct BestandFahrzeug { id: i64, funkrufname: String, kennzeichen, opta, fms_issi, fahrzeugtyp, standort: Option<String>, in_dienst: bool, kennungen: Vec<(String /*herkunft_norm*/, String)> }`, analog `BestandPersonal { id, name, personalnummer, telefon, traegerorganisation, in_dienst, qualifikation_ids: Vec<i64>, kennungen }`, `BestandQualifikation { id, label, aktiv: bool, kennungen }`, gesammelt in `struct Bestand { fahrzeuge, personal, qualifikationen }`.
  - `wire_enum! TrefferGrund { Kennung, Opta, Issi, Funkrufname, Personalnummer, Name, Bezeichnung }` (snake_case).
  - `enum Zuordnung { Neu, Gefunden { id: i64, grund: TrefferGrund }, Mehrdeutig { kandidaten: Vec<i64>, hinweis: Option<String> }, AusserDienst { id: i64 }, Fehler(String) }`
  - `fn fahrzeug_zuordnen(b: &Bestand, herkunft: &str, a: &FahrzeugAngabe) -> Zuordnung`
  - `fn personal_zuordnen(b: &Bestand, herkunft: &str, a: &PersonalAngabe) -> Zuordnung`
  - `fn qualifikation_zuordnen(b: &Bestand, herkunft: &str, text: &str) -> Zuordnung` (Kennung = Text, dann normalisierte Bezeichnung)
  - `fn name_teilen(name: &str) -> (String /*nach*/, Option<String> /*vor*/)` (Komma → „Nachname, Vorname“, sonst letztes Wort Nachname)
  - `fn erkennungswert_norm(s: &str) -> String` (Leerzeichen raus, Kleinschreibung; für OPTA, ISSI, Personalnummer)
  - `struct FeldAenderung { feld: &'static str, alt: Option<String>, neu: String, art: AenderungsArt /* Fuellt | WeichtAb */, erkennungsfeld: bool }`; `fn fahrzeug_aenderungen(bestand: &BestandFahrzeug, a: &FahrzeugAngabe) -> Vec<FeldAenderung>`, `fn personal_aenderungen(bestand: &BestandPersonal, a: &PersonalAngabe) -> Vec<FeldAenderung>` (Qualifikationen nicht hier).
  - `fn dubletten_in_datei(p: &StammdatenPaket, herkunft_default: &str) -> Vec<(StammdatenArt, u32)>` (gleiche Herkunft+Kennung zweimal → beide Zeilen).

- [ ] **Step 1: Tests:** je Stufe ein Treffer-Test (`fz_kennung_vor_opta`, `fz_opta`, `fz_issi`, `fz_funkrufname`, `p_personalnummer`, `p_name_komma`, `p_name_ohne_komma`, `q_bezeichnung_normalisiert`), `fz_opta_zwei_treffer_mehrdeutig_keine_tiefere_stufe`, `fz_kennung_trifft_ausser_dienst`, `fz_ziel_traegt_andere_kennung_derselben_herkunft_mehrdeutig`, `q_inaktiv_gefunden`, `q_zwei_labels_normalisiert_gleich_mehrdeutig`, `aenderungen_fuellt_und_weicht_ab` (leeres `opta` → `Fuellt`, anderes `standort` → `WeichtAb`, gleicher Wert → nichts, `funkrufname` → `erkennungsfeld: true`), `dubletten_beide_zeilen`, `herkunft_aus_zeile_vor_default`.
- [ ] **Step 2:** `cargo test --lib stammdaten_eingang::abgleich` → FAIL.
- [ ] **Step 3:** Implementieren. Reihenfolge der Stufen und „mehrdeutig stoppt“ exakt wie Spec. Außer-Dienst-Datensätze nehmen an Stufe 1 teil (für den Hinweis), an den übrigen Stufen nicht.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(stammdaten): Abgleich über Kennung, Erkennungsmerkmal und Name`.

### Task 5: Vorschau und Übernehmen (`repo.rs`)

**Files:**
- Create: `src/stammdaten_eingang/repo.rs`, `tests/stammdaten_eingang.rs` (Repo-Teil), `tests/fixtures/stammdaten/` (kleine CSV/XLSX nach Bedarf, oder im Test erzeugt)

**Interfaces:**
- Consumes: Task 3/4; `fahrzeug::repo::anlegen_tx`, `personal::repo::anlegen_tx`, `personal::qualifikation_repo` (Anlegen in Tx — fehlt eine `_tx`-Variante, hier ergänzen).
- Produces (DTOs `ToSchema`, `Serialize`/`Deserialize` snake_case):
  - `struct Entscheidungen { zeilen: Vec<ZeilenEntscheidung>, qualifikationen: Vec<QualiEntscheidung> }` mit `ZeilenEntscheidung { art: StammdatenArt, zeile: u32, wahl: ZeilenWahl }`, `wire_enum ZeilenWahl`-artig als serde-Enum: `Auslassen`, `Neu`, `Kandidat { id: i64 }`, `DateiUebernehmen`; `QualiEntscheidung { text: String, wahl: QualiWahl }` mit `Neu`, `Zuordnen { qualifikation_id: i64 }`, `Auslassen`. Höchstens `ENTSCHEIDUNGEN_MAX` je Liste.
  - `struct StammdatenVorschau { zaehlung: Zaehlung, zeilen: Vec<StammdatenZeile>, qualifikationen: Vec<QualiZeile>, meldungen: Vec<DateiMeldung>, nicht_uebernommen: Vec<String>, herkunft_noetig: bool, herkunft_vorschlag: Option<String>, uebernehmbar: bool }`
  - `struct StammdatenZeile { art, zeile, anzeige: String, ergebnis: ZeilenErgebnis /* neu|gefunden|mehrdeutig|ausser_dienst|fehler|unveraendert */, grund: Option<TrefferGrund>, kandidaten: Vec<Kandidat{id, anzeige}>, aenderungen: Vec<FeldAenderungDto>, hinweise: Vec<String>, wahl: Option<ZeilenWahl> }`
  - `struct Zaehlung { je Art: neu, ergaenzt, geaendert, unveraendert, ausgelassen, fehler }`, `struct StammdatenErgebnis { zaehlung: Zaehlung }`
  - `async fn vorschau(pool: &SqlitePool, org_id: i64, paket: &StammdatenPaket, meldungen, nicht_uebernommen, herkunft_default: Option<&str>, e: &Entscheidungen) -> Result<StammdatenVorschau, AppError>` — schreibt nichts.
  - `async fn uebernehmen(pool: &SqlitePool, org_id: i64, …gleiche Parameter…) -> Result<(StammdatenErgebnis, Vec<i64> /*geänderte fahrzeug_ids*/), AppError>` — eine Transaktion (`write_retry!`-Muster wie `personal::repo::anlegen`); rechnet die Vorschau in der Tx neu; `!uebernehmbar` → `AppError::Unprocessable`-Variante, die LLH-1556 für 422 mit Zeilen nutzt (`src/error.rs`, Schichtplan-Import).
  - Herkunft: Zeile → `herkunft_default` → keine; Kennung ohne Herkunft → `herkunft_noetig = true`, `uebernehmbar = false`. `herkunft_vorschlag` = jüngste Herkunft der Org aus `stammdaten_kennung`.
  - Schreiben: neue Datensätze per `anlegen_tx`; Änderungen nur `Fuellt`, plus `WeichtAb` bei Wahl `DateiUebernehmen` (Erkennungsfelder nur bei `grund == Kennung`); Kennung schreiben, wenn das Ziel für diese Herkunft noch keine hat; Qualifikationen am Personal nur hinzufügen; Qualifikations-Zuordnung (`Zuordnen`/`Neu`) als `stammdaten_kennung`-Zeile mit `qualifikation_id` und Kennung = Quelltext (`herkunft_norm`-normalisiert gespeichert, Kennung getrimmt).
  - Org-Prüfung: jedes Ziel einer Entscheidung (`Kandidat`, `Zuordnen`) muss zur Org gehören, sonst `Validation`.
  - Kollision Funkrufname/Personalnummer wird in der Vorschau gegen den Bestand plus die Datei selbst geprüft → `fehler`.

- [ ] **Step 1: Integrationstests in `tests/stammdaten_eingang.rs`** (Helfer aus `tests/common` wie `schichtplan_import.rs`): `neu_angelegt_mit_kennung`, `zweiter_lauf_unveraendert` (Zählung alles `unveraendert`, Zeilenzahl in `fahrzeug`/`stammdaten_kennung` gleich), `luecke_gefuellt`, `abweichung_nur_mit_wahl` (ohne Wahl bleibt alt, mit `DateiUebernehmen` neu), `erkennungsfeld_nur_bei_kennungstreffer` (über OPTA gefunden + anderer Funkrufname + `DateiUebernehmen` → Funkrufname bleibt), `umbenennung_kollidiert_fehler`, `von_hand_angelegtes_fahrzeug_wird_verknuepft`, `fremde_org_nie_getroffen`, `kandidat_fremder_org_validation`, `quali_neu_standard`, `quali_zuordnung_gemerkt` (zweiter Lauf: keine offene Quali-Entscheidung, Person hat die zugeordnete Qualifikation), `quali_nie_entfernt`, `ausser_dienst_ausgelassen`, `fehler_blockiert_alles` (eine Fehlerzeile → 0 Zeilen geschrieben), `kennung_ohne_herkunft_nicht_uebernehmbar`, `vorschau_schreibt_nichts`.
- [ ] **Step 2:** `cargo test --test stammdaten_eingang` → FAIL.
- [ ] **Step 3:** Implementieren (`bestand_tx(conn, org_id) -> Bestand` liest alles der Org in einem Rutsch, inkl. Kennungen).
- [ ] **Step 4:** → PASS; `cargo test --test schichtplan_import` weiter PASS.
- [ ] **Step 5:** Commit `feat(stammdaten): Vorschau und Übernehmen in einer Transaktion`.

### Task 6: Routen, Hub-Sperre, OpenAPI

**Files:**
- Create: `src/routes/stammdaten_eingang.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs` (Routen neben `/api/vehicles`, Body-Limit wie `SCHICHTPLAN_IMPORT_BODY_MAX`), `src/api_doc.rs`, `tests/stammdaten_eingang.rs` (HTTP-Teil), `tests/enum_wire_kontrakt.rs` (neue Enums), ggf. `src/routes/fahrzeug.rs` (`stamm_geaendert_melden` auf `pub(crate)`)

**Interfaces:**
- Consumes: `repo::{vorschau, uebernehmen}`, `datei::lies_paket`, `hub_fuer_org`.
- Produces: `POST /api/master-data/import/preview` → `200 StammdatenVorschau`; `POST /api/master-data/import` → `200 StammdatenErgebnis`, `422` mit `StammdatenVorschau`-Zeilen wie LLH-1556, `400` unlesbar, `403` ohne Admin, `409` wenn `hub_fuer_org(..).is_some()`. Multipart-Felder `datei` (Pflicht), `herkunft` (Text, ≤ 100), `entscheidungen` (JSON); anderes Feld → 400 (wie `lies_einlese_anfrage`). Parsen in `spawn_blocking`. Nach Übernehmen `stamm_geaendert_melden` je geändertem Fahrzeug; `tracing::info!` mit Org, Benutzer, Herkunft, Zählung (keine Feldwerte).

- [ ] **Step 1: HTTP-Tests:** `preview_200_und_schreibt_nichts`, `import_200_zaehlung`, `ohne_admin_403`, `org_am_hub_409` (Kopplung `meldet_sich` anlegen wie in den Adapter-Tests), `unbekanntes_feld_400`, `unlesbar_400`, `nicht_uebernehmbar_422`, `iban_wert_nicht_in_antwort` (Antwortkörper enthält den IBAN-Wert nicht, `nicht_uebernommen` enthält `IBAN`), Wire-Kontrakt-Einträge für `StammdatenArt`, `TrefferGrund`, `ZeilenErgebnis`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementieren; `scripts/check-typ-codegen.sh` laufen lassen, generierte Dateien übernehmen.
- [ ] **Step 4:** `cargo test --test stammdaten_eingang --test enum_wire_kontrakt` → PASS; `scripts/check-typ-codegen.sh` → grün.
- [ ] **Step 5:** Commit `feat(stammdaten): Routen zum Einlesen der Stammdaten-Datei`.

### Task 7: Oberfläche „Stammdaten einlesen“

**Files:**
- Create: `frontend/src/api/stammdatenEingang.ts`, `frontend/src/stammdaten/StammdatenEinlesen.tsx`, `frontend/src/stammdaten/StammdatenVorschauAnsicht.tsx`, `frontend/src/stammdaten/StammdatenEinlesen.test.tsx`
- Modify: `frontend/src/api/eingabegrenzen.ts` (`STAMMDATEN_DATEI_MAX_BYTES = 2 * 1024 * 1024`), `frontend/src/api/types.ts` (Re-Exports), `frontend/src/stammdaten/FahrzeugeTab.tsx`, `frontend/src/stammdaten/PersonalTab.tsx` (Knopf im Kopf)

**Interfaces:**
- Consumes: generierte Typen aus Task 6.
- Produces: `stammdatenEinlesenVorschau(datei: File, herkunft: string | undefined, e: Entscheidungen)`, `stammdatenEinlesen(...)` über `apiUpload` (60 s wie `api/schichtplan.ts`); `<StammdatenEinlesen />` (Knopf + Modal), nach Erfolg Invalidierung der Queries für Fahrzeuge, Personal und Qualifikationen.

- [ ] **Step 1: Vitest** (Harness wie `abloesung/schichtplan/SchichtplanEinlesen.test.tsx`): `zeigt_herkunft_feld_wenn_noetig` (Antwort `herkunft_noetig: true` → Eingabefeld mit Vorschlag vorbelegt), `wahl_schickt_entscheidungen_neu` (Auswahl „Datei übernehmen“ → zweiter Vorschau-Aufruf mit passendem `entscheidungen`-JSON), `uebernehmen_gesperrt_bei_fehlern`, `ergebnis_zeigt_zaehlung`, `nicht_uebernommen_wird_genannt`.
- [ ] **Step 2:** `pnpm -C frontend vitest run src/stammdaten/StammdatenEinlesen.test.tsx` → FAIL.
- [ ] **Step 3:** Implementieren nach dem Muster von `SchichtplanEinlesen.tsx`/`ImportVorschauAnsicht.tsx`: Schritt 1 Datei (`.csv,.xlsx`, Größencheck) + Herkunft; Schritt 2 Vorschau (Zählmarken je Art, Zeilen mit offener Entscheidung zuerst, Qualifikationen unbekannter Quelle als eigener Block); Schritt 3 Ergebnis. Knopftext „Stammdaten einlesen“. Wortregeln aus `frontend/AGENTS.md`.
- [ ] **Step 4:** → PASS; `pnpm -C frontend typecheck` und `pnpm -C frontend lint` grün.
- [ ] **Step 5:** Commit `feat(stammdaten): Stammdaten-Datei in der Verwaltung einlesen`.

### Task 8: Vertrag, Musterdateien, e2e, Prüfstein

**Files:**
- Create: `docs/schnittstellen/stammdaten-datei.md`, `docs/schnittstellen/beispiele/stammdaten-fahrzeuge.csv`, `docs/schnittstellen/beispiele/stammdaten.xlsx` (per Test-Helfer oder Skript erzeugt, eingecheckt), e2e-Spec unter `frontend/e2e/` neben dem Schichtplan-Import-Spec
- Modify: `tests/stammdaten_eingang.rs` (Test `musterdateien_lesbar`: beide Musterdateien → Vorschau ohne Meldung), ggf. Release-Notiz nach `frontend/AGENTS.md`/Projektregel (neues Feature → Pflicht prüfen)

- [ ] **Step 1:** Test `musterdateien_lesbar` + Test `kein_herstellername_im_code` (durchsucht `src/stammdaten_eingang`, `src/einlesen`, `src/routes/stammdaten_eingang.rs`, `frontend/src/stammdaten/StammdatenEinlesen*.tsx`, `migrations/0373_*` nach einer kleinen Liste verbotener Namen, Groß-/Kleinschreibung egal) → FAIL (Dateien fehlen).
- [ ] **Step 2:** Vertrag schreiben (Spalten, Arterkennung, Grenzen, Abgleich, zweiter Lauf, Beispiel), Musterdateien anlegen.
- [ ] **Step 3:** e2e: Musterdatei hochladen → Vorschau → Übernehmen → Fahrzeug mit OPTA in der Liste; zweiter Upload → „unverändert“.
- [ ] **Step 4:** `cargo test --test stammdaten_eingang`, e2e-Spec lokal; danach `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 5:** Commit `docs(stammdaten): Vertrag Stammdaten-Datei mit Musterdateien`.
