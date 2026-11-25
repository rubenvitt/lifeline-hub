# PASS-Liste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Einsatzleitung exportiert die Betroffenen als PASS-Liste, als CSV für Excel und als Druckansicht. Beides ist protokolliert und unter eigener Art im Zugriffsprotokoll.

**Architecture:** `src/person/pass.rs` bildet aus `PersonAnzeige` fertige `PassZeile`n, rein und ohne DB. Die bestehenden Handler `export` und `druck` in `src/routes/einsatz_person.rs` nehmen `?profile=pass`, verlangen dann die Einsatzleitung, schreiben `pass_export` bzw. `pass_druck` und liefern CSV bzw. `Vec<PassZeile>`. Das Frontend zeigt die Zeilen nur an.

**Tech Stack:** Rust (axum, sqlx/SQLite, utoipa), React/TypeScript (TanStack Query, Vitest, msw).

**Spec:** `docs/superpowers/specs/2026-11-24-sco62ku3-pass-liste-design.md`

## Global Constraints

- Keine neuen API-Pfade: nur `?profile=pass` an `GET /api/einsaetze/{id}/persons/export` und `…/persons/print`. Ein unbekanntes `profile` gibt 400.
- Mit `profile=pass` gilt `ctx.fordere_einsatzleitung()?` vor jedem Lesen. Sonst 403, auch für jedes Gerät.
- Erst der Audit-Eintrag, dann die Daten.
- Protokollarten `pass_export` und `pass_druck`, Texte „PASS-Liste exportiert“ und „PASS-Liste gedruckt“.
- CSV: UTF-8 mit BOM (`\u{FEFF}`), Trennzeichen `;`, Zeilenende `\r\n`, jedes Feld über `csv_feld`.
- Spalten in dieser Folge, Kopfzeile wörtlich: `Kennung;Name;Vorname;Geburtsdatum;Alter (geschätzt);Geschlecht;Anschrift;Art der Betroffenheit;Verbleib;Erfasst am`.
- Betroffenheit, die erste passende Regel gewinnt:
  1. `verstorben`: Status `verstorben`, Verbleib-Art `verstorben` oder Sichtung `tot`
  2. `vermisst`: Status `vermisst`
  3. `verletzt/erkrankt`: Sichtung `sk1` bis `sk4` oder eine nicht aufgehobene Maßnahme bzw. Verletzung
  4. `untergebracht`: Verbleib-Art `notunterkunft`
  5. `unverletzt`: alles Übrige
- Geburtsdatum `TT.MM.JJJJ`, sonst roh. Alter nur ohne Geburtsdatum. Geschlecht als Wort: männlich, weiblich, divers, unbekannt.
- Verbleib: `aktueller_verbleib`; sonst `UHS <Bezeichnung>` bei `aktuelle_uhs_id`; sonst leer.
- „Erfasst am“ als `%d.%m.%Y %H:%M` in der Zone aus `zeitdarstellung::zeitstil_laden(...).zone`.
- Sortierung nach Name, Vorname, Registriernummer; ohne Name ans Ende, Vergleich ohne Groß-/Kleinschreibung.
- Wortlaut der Zweckbindung: „Die PASS-Liste enthält Personendaten Betroffener. Nur für die Personenauskunft verwenden und nicht weitergeben. Der Abruf wird protokolliert.“ Auf dem Blatt: „Zweckgebunden: nur für die Personenauskunftsstelle.“
- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`). Commits, Kommentare und Testnamen deutsch. Jeder Commit-Body trägt `Zunder: https://zunder.rubeen.dev/#/aufgabe/sco62ku34q5d2elirhh9heuj`.

## Review Focus

- **Ein Gerät oder Führungspersonal ruft `?profile=pass` direkt auf:** 403, und es entsteht kein Audit-Eintrag (Task 3).
- **Ein Name mit `=`, `+`, `-` oder `@` am Anfang:** im PASS-CSV entschärft wie im alten Export (Task 2).
- **Eine aufgehobene Maßnahme:** macht niemanden verletzt; eine offene schon (Task 2, Task 3).
- **Stornierte Personen:** fehlen in CSV und Druck (Task 3).
- **Ein Altbestand-Geburtsdatum wie „ca. 1950“:** erscheint roh und bricht nichts (Task 2).

---

### Task 1: Protokollarten `pass_export` und `pass_druck`

**Files:**
- Create: `migrations/0384_person_zugriff_audit_pass.sql`. Die Nummer ist die nächste über allem auf `origin/alpha`; vorher `scripts/check-migrationen.sh` prüfen.
- Modify: `src/person/audit_repo.rs` (Enum `ZugriffArt`, Doku-Kommentare)
- Modify: `tests/enum_wire_kontrakt.rs:925` (`ZugriffArt`)
- Test: `src/db/tests.rs` (neben `migration_0311_…`)

**Interfaces:**
- Produces: Wire-Werte `"pass_export"`, `"pass_druck"` für `audit_repo::create(…, art)`; `ZugriffArt::PassExport`, `ZugriffArt::PassDruck`.

- [ ] **Step 1: Failing test** `migration_0384_person_zugriff_audit_rebuild_erhaelt_zeilen_sequenz_und_schema` in `src/db/tests.rs`. Aufbau wie der 0311-Test: Alt-DB, 0141 und 0311 einspielen, drei Zeilen inklusive `registrierliste` einfügen, die höchste löschen, dann `pruefe_audit_rebuild(&pool, MIGRATION_0384, "pass_export")`. Dazu ein Insert mit `'pass_druck'`, der gelingt, und einer mit `'pass_irgendwas'`, der am CHECK scheitert.
- [ ] **Step 2:** Ausführen mit `cargo test --lib migration_0381`. Erwartet: Kompilierfehler, `MIGRATION_0384` fehlt.
- [ ] **Step 3:** Migration schreiben: Kopie von 0311 als Blatt-Umbau, **ohne** `-- no-transaction` (`migrations/AGENTS.md`, „Tabellenumbau“; die Tabelle hat keine Verweise auf sich). Der CHECK wird `('detail','export','druck','anhang','registrierliste','pass_export','pass_druck')`. Den Kopfkommentar nach dem Muster von 0311 mit Verweis auf LLH-1198. Dann `const MIGRATION_0384` per `include_str!`. Laut 0311 braucht der Spaltenkommentar den gleichen Wortlaut, das gilt auch hier.
- [ ] **Step 4:** In `ZugriffArt` `PassExport` und `PassDruck` ergänzen, mit Doku-Zeile (Abruf über `?profile=pass`). Den Kommentar zum Wire-CHECK auf 0381 nachziehen. `enum_wire!` um `PassExport => "pass_export"` und `PassDruck => "pass_druck"` erweitern.
- [ ] **Step 5:** Ausführen mit `cargo test --lib migration_0381 && cargo test --test enum_wire_kontrakt`. Erwartet: PASS.
- [ ] **Step 6:** Commit `feat(personen): Protokollarten pass_export und pass_druck`.

### Task 2: `src/person/pass.rs`: Zeilen, Betroffenheit, CSV

**Files:**
- Create: `src/person/pass.rs`. Registrieren in `src/person/mod.rs` mit `pub mod pass;`.
- Modify: `src/routes/einsatz_person.rs`: `csv_feld` wird `pub(crate)` und zieht nach `src/person/pass.rs`. Der Altexport importiert es von dort, oder es geht in ein gemeinsames Modul; Hauptsache, es gibt nur eine Definition.
- Test: Unit-Tests in `src/person/pass.rs`

**Interfaces:**
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum PassBetroffenheit { Verstorben, Vermisst, VerletztErkrankt, Untergebracht, Unverletzt }` mit `pub fn wort(&self) -> &'static str`. Die Wörter: „verstorben“, „vermisst“, „verletzt/erkrankt“, „untergebracht“, „unverletzt“. Ein reines Server-Enum ohne Wire-Wert, also kein `wire_enum!` (ADR-0006 gilt für Werte auf dem Draht).
  - `pub fn betroffenheit(p: &PersonAnzeige, hat_offene_versorgung: bool) -> PassBetroffenheit`
  - `#[derive(Debug, Serialize, ToSchema)] pub struct PassZeile { id_label, last_name, first_name, birth_date, age, sex, address, affectedness, whereabouts, recorded_at: String }`. Ein neuer Typ, also englische Wire-Felder (Wurzel-`AGENTS.md`, „API-Routen englisch“). Alle Felder sind `String` mit fertigem Text in der Reihenfolge der CSV-Spalten, leer heißt keine Angabe.
  - `pub struct PassKontext<'a> { pub zone: chrono_tz::Tz, pub uhs_namen: &'a HashMap<i64, String>, pub mit_versorgung: &'a HashSet<i64> }`
  - `pub fn pass_zeilen(personen: &[PersonAnzeige], k: &PassKontext) -> Vec<PassZeile>`: bildet und sortiert.
  - `pub fn pass_csv(zeilen: &[PassZeile]) -> String`: BOM, Kopf, CRLF.

- [ ] **Step 1: Failing tests** (eine Person per Helfer `person(..)` mit Default-Feldern aufbauen):
  - `sichtung_tot_gilt_als_verstorben`: Status `betroffen`, Sichtung `Tot` ergibt `Verstorben`.
  - `status_verstorben_vor_vermisst` und `verbleib_verstorben_gilt_als_verstorben`.
  - `vermisst_vor_verletzt`: Status `Vermisst`, Sichtung `Sk1` ergibt `Vermisst`.
  - `sk1_bis_sk4_gelten_als_verletzt`, über alle vier.
  - `sichtung_unverletzt_bleibt_unverletzt`.
  - `offene_versorgung_ohne_sichtung_gilt_als_verletzt`: `hat_offene_versorgung = true` ergibt `VerletztErkrankt`.
  - `notunterkunft_gilt_als_untergebracht`, `abgemeldet_ohne_weiteres_ist_unverletzt`.
  - `geburtsdatum_wird_deutsch_und_alter_entfaellt`: `"1950-03-07"` wird `"07.03.1950"`, Alter `""`, auch wenn `alter_geschaetzt = Some(70)`.
  - `geburtsdatum_altbestand_bleibt_roh`: `"ca. 1950"` bleibt `"ca. 1950"`.
  - `ohne_geburtsdatum_steht_alter`: `alter_geschaetzt = Some(40)` ergibt `"40"`.
  - `verbleib_uhs_ohne_verbleib`: `aktueller_verbleib = None`, `aktuelle_uhs_id = Some(3)`. Mit `uhs_namen{3:"Halle 2"}` erwartet `"UHS Halle 2"`. Beginnt die Bezeichnung schon mit „UHS“, kein Präfix: `{3:"UHS Nord"}` ergibt `"UHS Nord"`. Ohne bekannten Namen `"UHS"`.
  - `verbleib_geht_vor_uhs`: `aktueller_verbleib = Some("Transport → KH Mitte")` gewinnt gegen eine gesetzte `aktuelle_uhs_id`.
  - `erfasst_at_in_ortszeit`: `erfasst_at = "2026-11-24 13:05:00"` (UTC), Zone Europe/Berlin, ergibt `"24.11.2026 14:05"`.
  - `sortiert_nach_name_vorname_kennung_namenlose_zuletzt`.
  - `csv_hat_bom_kopf_und_crlf`: beginnt mit `"\u{FEFF}Kennung;Name;Vorname;Geburtsdatum;Alter (geschätzt);Geschlecht;Anschrift;Art der Betroffenheit;Verbleib;Erfasst am\r\n"`.
  - `csv_entschaerft_formel`: Name `"=SUM(A1)"` ergibt das Feld `"\"'=SUM(A1)\""`.
- [ ] **Step 2:** Ausführen mit `cargo test --lib person::pass`. Erwartet: FAIL, nicht kompiliert.
- [ ] **Step 3:** `pass.rs` nach den Interfaces implementieren. Das Datum über `crate::zeit::parse_utc` + `with_timezone(&k.zone)`. Ist der Wert nicht lesbar, steht er roh. Das Geburtsdatum per `NaiveDate::parse_from_str(s, "%Y-%m-%d")`.
- [ ] **Step 4:** Ausführen mit `cargo test --lib person::pass`. Erwartet: PASS. Außerdem `cargo test --test einsatz_person export_` (Altexport unverändert), erwartet PASS.
- [ ] **Step 5:** Commit `feat(personen): PASS-Zeilen und PASS-CSV`.

### Task 3: Abruf über `?profile=pass`

**Files:**
- Modify: `src/routes/einsatz_person.rs` (`export`, `druck`, neue `ExportParams`)
- Modify: `src/api_doc.rs` (Schemas `PassZeile`)
- Modify: `frontend/src/api/types.generated.ts`, plus die zweite generierte Datei, per `scripts/check-typ-codegen.sh`
- Test: `tests/einsatz_person.rs`

**Interfaces:**
- Consumes: `pass::{pass_zeilen, pass_csv, PassKontext, PassZeile}` aus Task 2; Wire-Arten aus Task 1.
- Produces:
  - `GET …/persons/export?profile=pass` liefert `text/csv; charset=utf-8`.
  - `GET …/persons/print?profile=pass` liefert JSON `PassZeile[]`.
  - `#[derive(Deserialize)] pub struct ExportParams { pub profile: Option<String> }`. Erlaubt ist nur `"pass"`, sonst `AppError::Validation("Unbekanntes Exportprofil")` (400).

- [ ] **Step 1: Failing tests** in `tests/einsatz_person.rs`. Hilfsfunktionen wie in `export_entschaerft_formel_injektion`.
  - `pass_export_liefert_bom_kopf_und_betroffenheit`: zwei Personen anlegen, eine mit Sichtung `sk2`. Erwartet: 200, Body beginnt mit BOM + Kopfzeile, enthält `"verletzt/erkrankt"` und `"unverletzt"`.
  - `pass_export_schreibt_pass_export_ins_protokoll`: danach liefert `GET …/persons/list-accesses` genau einen Eintrag `art == "pass_export"`, und keinen `export`.
  - `pass_druck_liefert_zeilen_und_protokolliert`: `GET …/persons/print?profile=pass` liefert ein JSON-Array mit `affectedness`, ein Eintrag `pass_druck`.
  - `pass_profil_nur_fuer_einsatzleitung`: ein Benutzer mit Rolle Führungspersonal bekommt 403 für beide Pfade, und `list-accesses` (als Leitung) zeigt keinen `pass_*`-Eintrag. Wie ein Führungspersonal-Mitglied angelegt wird, steht in den bestehenden Tests zu `listenzugriffe`.
  - `pass_profil_verweigert_geraet`: gekoppeltes Gerät (Helfer aus `tests/geraet_kopplung.rs`) bekommt 403.
  - `unbekanntes_profil_ist_400`: `?profile=xyz` gibt 400 für beide Pfade.
  - `pass_export_ohne_stornierte_und_aufgehobene_massnahme_zaehlt_nicht`: Person A storniert, Person B mit einer Maßnahme, die wieder aufgehoben ist. A fehlt, B ist `unverletzt`.
  - `export_ohne_profil_unveraendert`: der bisherige Kopf `registrier_nr;status;…` ohne BOM, Art `export`.
- [ ] **Step 2:** Ausführen mit `cargo test --test einsatz_person pass_`. Erwartet: FAIL.
- [ ] **Step 3:** In beiden Handlern `Query(params): Query<ExportParams>` ergänzen. Ist das Profil `pass`, in dieser Reihenfolge:
  1. `ctx.fordere_einsatzleitung()?`
  2. Audit (`"pass_export"` bzw. `"pass_druck"`)
  3. `repo::liste`
  4. `zeitstil_laden(&state.pool, einsatz_id)`
  5. die UHS-Bezeichnungen des Einsatzes (`SELECT id, bezeichnung FROM uhs WHERE einsatz_id = ?`)
  6. die Person-IDs mit offener Versorgung, als eine Abfrage per `UNION` über `person_massnahme` und `person_verletzung` mit `aufgehoben_at IS NULL` (Spaltennamen gegen das Schema prüfen)
  7. `pass_zeilen`

  Der Rückgabetyp von `druck` wird `Response`, mit `Json(...).into_response()` je Zweig. `PassZeile` in `api_doc.rs` registrieren.
- [ ] **Step 4:** Ausführen mit `cargo test --test einsatz_person && cargo test --test einsatz_kontext_guard && cargo test --test zulassung_guard`. Erwartet: PASS.
- [ ] **Step 5:** Ausführen mit `scripts/check-typ-codegen.sh`, die generierten Dateien übernehmen. Erwartet: grün, `PassZeile` steht in `types.generated.ts`.
- [ ] **Step 6:** Commit `feat(personen): PASS-Liste über ?profile=pass abrufen`.

### Task 4: Frontend: Abruf, Protokolltexte, Dateiname

**Files:**
- Modify: `frontend/src/api/einsatzPerson.ts`, `frontend/src/api/types.ts` (Export `PassZeile = S['PassZeile']`), `frontend/src/components/dateiSpeichern.ts`, `frontend/src/personen/zugriffArt.ts`, `frontend/src/api/queryKeys.ts`
- Test: `frontend/src/api/einsatzPerson.test.ts`, `frontend/src/personen/zugriffArt.test.ts` (anlegen, falls nicht vorhanden), `frontend/src/components/dateiSpeichern.test.ts`

**Interfaces:**
- Produces:
  - `ladePassListeExport(einsatzId: number): Promise<Blob>` mit `…/persons/export?profile=pass`, `EXPORT_TIMEOUT_MS`.
  - `ladePassListeDruck(einsatzId: number): Promise<PassZeile[]>` mit `…/persons/print?profile=pass`.
  - `ExportInhalt` um `'pass-liste'` erweitert.
  - `EINSATZ_KEYS.passListeDruck = 'einsatz-pass-liste-druck'` mit `einsatzKeys.passListeDruck(id)`. In derselben Liste wie `personenDruck` aufnehmen (queryKeys.ts:639).
  - `ZUGRIFF_ART_TEXT.pass_export = 'PASS-Liste exportiert'`, `pass_druck = 'PASS-Liste gedruckt'`.

- [ ] **Step 1: Failing tests:**
  - Die URLs beider Loader per msw.
  - `exportDateiname('pass-liste', 7, new Date(2026,10,24,9,5))` ergibt `'pass-liste-einsatz-7-2026-11-24-0905.csv'`.
  - `zugriffArtText({art:'pass_export', person_id:null})` ergibt `'PASS-Liste exportiert'`.
- [ ] **Step 2:** Ausführen mit `mise exec -- pnpm -C frontend exec vitest run src/api/einsatzPerson.test.ts src/personen src/components/dateiSpeichern.test.ts`. Erwartet: FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** Dasselbe Kommando plus `mise exec -- pnpm -C frontend exec tsc --noEmit`. Erwartet: PASS.
- [ ] **Step 5:** Commit `feat(personen): PASS-Liste im Client abrufen`.

### Task 5: Druckansicht „PASS-Liste“

**Files:**
- Create: `frontend/src/pages/PassListeDruckPage.tsx`, `frontend/src/personen/PassListeDruckTabelle.tsx`
- Modify: `frontend/src/App.tsx` (Route `personen/pass-druck` neben `personen/druck`), `frontend/src/routing/deeplinks.ts` (`passListeDruckPfad(einsatzId: number): string` → `/einsaetze/${id}/personen/pass-druck`)
- Test: `frontend/src/pages/PassListeDruckPage.test.tsx`, `frontend/src/routing/deeplinks.test.ts`

**Interfaces:**
- Consumes: `ladePassListeDruck`, `einsatzKeys.passListeDruck`, `PassZeile` aus Task 4.
- Produces: `passListeDruckPfad`.

- [ ] **Step 1: Failing tests** in `PassListeDruckPage.test.tsx`:
  - `zeigt die Zeilen mit Kopf in PASS-Reihenfolge`: eine Zeile, die zehn Spaltenköpfe wie im CSV, die Zellen enthalten die Texte unverändert.
  - `nennt die Zweckbindung am Bildschirm und auf dem Blatt`: beide Wortlaute aus den Global Constraints stehen da.
  - `lädt genau einmal und wiederholt nicht bei Fehler`: msw 500 ergibt einen Request und eine Fehlermeldung (`DRUCK_ABFRAGE`).
  - In `deeplinks.test.ts`: `passListeDruckPfad(7)` ergibt `'/einsaetze/7/personen/pass-druck'`.
- [ ] **Step 2:** Ausführen mit `mise exec -- pnpm -C frontend exec vitest run src/pages/PassListeDruckPage.test.tsx src/routing/deeplinks.test.ts`. Erwartet: FAIL.
- [ ] **Step 3:** Die Seite nach `PersonenDruckPage` bauen:
  - `ListenDruckSeite` mit `modul="Betroffene"`, `dokumentart="PASS-Liste"`, `hinweis` = Zweckbindung am Bildschirm, `zurueckPfad = personenPfad(einsatzId, {})`
  - `umfang` über `umfangText(n,'Person','Personen')`
  - `...DRUCK_ABFRAGE`, `gcTime: 0`
  - Die Tabelle über `DruckTabelle` aus `druck/`, mit dem Blatt-Hinweis darüber.
- [ ] **Step 4:** Dasselbe Kommando. Erwartet: PASS. Dazu `vitest run src/druck` (Wortlaut-Wächter), erwartet PASS.
- [ ] **Step 5:** Commit `feat(personen): Druckansicht PASS-Liste`.

### Task 6: Einstiege in der Personenliste, Bestätigung vor dem CSV

**Files:**
- Create: `frontend/src/personen/PassExportDialog.tsx`
- Modify: `frontend/src/pages/PersonenPage.tsx:1074-1110`
- Test: `frontend/src/pages/PersonenPage.test.tsx`

**Interfaces:**
- Consumes: `ladePassListeExport`, `useCsvExport(einsatzId, 'pass-liste', ladePassListeExport)`, `passListeDruckPfad`, `druckansichtNebenweg` bzw. `druckansichtVon('PASS-Liste')` aus `components/druck/useDruckNebenwege.ts`.
- Produces: `PassExportDialog({ offen, laeuft, onExportieren, onAbbrechen })`, ein Modal mit Titel „PASS-Liste exportieren“, dem Wortlaut der Zweckbindung und den Knöpfen „Exportieren“ (primär) und „Abbrechen“.

- [ ] **Step 1: Failing tests** in `PersonenPage.test.tsx`, neben den CSV-Tests (Zeile ~1645):
  - `Einsatzleitung sieht beide PASS-Einträge unter Weitere`: die Einträge „PASS-Liste – Druckansicht“ und „PASS-Liste als CSV“.
  - `Führungspersonal sieht keinen PASS-Eintrag`.
  - `PASS-CSV fragt erst nach und lädt erst nach Exportieren`: Klick auf den Eintrag öffnet den Dialog mit der Zweckbindung, ohne Request. „Abbrechen“ schickt keinen Request, „Exportieren“ genau einen an `…/persons/export?profile=pass`.
  - `PASS-Druckansicht führt zur Druckseite`: die Navigation geht auf `/einsaetze/1/personen/pass-druck`.
  - `Fehler des PASS-Exports steht an der Seite`: msw 500 zeigt den Hinweis „Export fehlgeschlagen“ im `hinweis`-Slot.
- [ ] **Step 2:** Ausführen mit `mise exec -- pnpm -C frontend exec vitest run src/pages/PersonenPage.test.tsx`. Erwartet: FAIL.
- [ ] **Step 3:** In `weitere.eintraege` innerhalb `istEinsatzLeitung(einsatz)` vor „Listenzugriffe“ einhängen:
  - `druckansichtNebenweg({ ziel: passListeDruckPfad(einsatzId), navigate, dokument: 'PASS-Liste' })`. Die Signatur des Helfers prüfen; nennt er das Dokument anders, nach ihm richten.
  - den Eintrag `pass-csv`, der den Dialog öffnet.

  Den Fehler des zweiten `useCsvExport` in den bestehenden `hinweis`-Slot einhängen, wie `csvExport.fehler`.
- [ ] **Step 4:** Dasselbe Kommando plus `vitest run src/druck/druckWortlaut.guard.test.ts`. Erwartet: PASS.
- [ ] **Step 5:** Commit `feat(personen): PASS-Liste in der Personenliste anbieten`.

### Task 7: Doku, Nachzug, Gates

**Files:**
- Modify: das Kapitel „Drucken und Export“ unter `docs/anwender/`, per `grep -rl "Drucken und Export" docs/anwender`, nach `docs/anwender/AGENTS.md`. Ein Absatz zur PASS-Liste: wer, was, Zweckbindung, Protokoll, vorläufiges Format.
- Modify: `frontend/src/personen/AGENTS.md`, ein Punkt „PASS-Liste (LLH-1198)“: Ableitung und Recht nur in `src/person/pass.rs` bzw. am Server, der Client zeigt nur an.

- [ ] **Step 1:** Doku und Bereichsregel schreiben. Danach `mise exec -- pnpm -C frontend exec prettier --check AGENTS.md src/personen/AGENTS.md`, erwartet: sauber.
- [ ] **Step 2:** Ausführen mit `./scripts/check-all.sh --geaendert --ohne-e2e` (ein Aufruf, bei Bedarf im Hintergrund). Erwartet: alle Schritte grün.
- [ ] **Step 3:** Commit `docs(personen): PASS-Liste in Hilfe und Bereichsregeln`.
- [ ] **Step 4:** Der Main-Loop legt die Nachzug-Aufgabe „PASS-Liste an das GSL.net-Importformat anpassen“ an (`zunder-task-anlegen`). Status `blocked`, wartet auf ein Muster der Importdatei.
