# Fahrzeugortung in gespiegelten Einsätzen: Umsetzungsplan (LLH-2119)

> **Für ausführende Agenten:** PFLICHT-SKILL: superpowers:subagent-driven-development (empfohlen)
> oder superpowers:executing-plans; Schritte als Checkboxen (`- [x]`).

**Ziel:** Ein ELW, das einen Einsatz führt, koppelt Fahrzeuge an Einwurf-Kennungen seines Hubs. Die
Positionen kommen im Spiegelabgleich ans ELW.

**Architektur:** `ortung_kopplung` bekommt eine zweite Zugangsart (Hub). Das ELW nennt im
`SpiegelPaket` seine gekoppelten Hub-Kennungen und wünscht bei Bedarf Kandidaten. Der Hub
antwortet außerhalb der Abgleichstransaktion, nur lesend. Das ELW übernimmt über einen zweiten
Einstieg in `uebernahme.rs`. `werde_spiegel` trennt still.

**Technik:** Rust (axum, sqlx/SQLite), React/TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md`
(freigegeben 25.11.2026). Bezug: ADR-0103, ADR-0018, ADR-0023, ADR-0039.

## Globale Vorgaben

- Neue Wire-Felder und -Typen englisch, mit `#[serde(default)]` (`PROTOKOLL_SPIEGEL` bleibt 2).
- Kein `tracing::`-Feld mit Kennung, Schlüssel oder Koordinaten (Prüfmuster aus ADR-0103).
- Kein neuer Zustand am Hub; Koordinaten nur für angefragte, gültige Kennungen.
- Geschrieben wird nur über `ortung::schreibe_position` mit `Positionsquelle::Einwurf`.
- Drossel `ORTUNG_DROSSEL_S = 15` gilt; auf dem Hub-Weg kein Nachlauf.
- Höchstens 200 `tracking_requests` je Paket; Überzählige überliest der Hub.
- Kandidaten-Puffer: 60 s gültig, älter als 10 s gilt als `pending`; Dialog fragt alle 2 s nach,
  höchstens 15 s lang.
- Bezeichner nach `AGENTS.md`: Fachbegriffe deutsch, Technik englisch. Prosa deutsch.
- Migration: nächste freie Nummer **0387** (umgelegt, s. LLH-2136) (vorher `git fetch origin alpha` und
  `scripts/check-migrationen.sh`); Blatt-Umbau ohne `-- no-transaction`.
- Nach jeder DTO-Änderung `scripts/check-typ-codegen.sh`, generierte Dateien mitcommitten.
- Commit-Body: `Zunder: https://zunder.rubeen.dev/#/aufgabe/ypcadxzog8lomshl4wapmybc`.

## Review-Fokus

1. Ein älterer Hub antwortet ohne die neuen Felder: Das ELW bleibt gekoppelt, schreibt nichts
   und wirft keinen Fehler (Test in Task 3).
2. Der Zugang am Hub wird nach dem Koppeln widerrufen oder läuft ab: Es kommen keine Positionen
   mehr, und der Abgleich läuft weiter (Test in Task 2).
3. Dieselbe Kennung in zwei Einsätzen am ELW: Das zweite PUT antwortet 409, auch bei einer
   Hub-Kopplung (Test in Task 4).
4. Ein SQL-Fehler beim Zusammenstellen der Hub-Antwort darf den Abgleich nicht zurückrollen
   (Task 2: die Felder bleiben leer, Test mit gelöschter Tabelle `position_letzte` im Test-Pool).
5. Führungsabgabe mit Hub-Kopplung: kein `bruch_offen` am neuen Spiegel (Test in Task 5).

---

### Task 1: Tabelle `ortung_kopplung` mit Hub-Zugängen

**Dateien:**
- Neu: `migrations/0387_ortung_kopplung_hub.sql`
- Ändern: `src/ortung/kopplung.rs` (`Kopplung`, `SELECT_KOPPLUNG`, `create_kopplung_tx`)
- Ändern: `src/ortung/uebernahme.rs` (`run_nachlauf`), `src/routes/ortung.rs`
  (`From<Kopplung>`), `src/fahrzeug/disposition_repo.rs` (Vorzustand aus `Kopplung`)
- Test: `tests/ortung.rs`

**Schnittstellen:**
- Erzeugt die Tabelle `ortung_kopplung(einsatz_fahrzeug_id PK, einsatz_id, org_id, zugang_id TEXT
  NULL → einwurf_zugang, instanz_kopplung_id INTEGER NULL → instanz_kopplung(id) ON DELETE
  CASCADE, fremder_zugang_id TEXT NULL, zugang_name TEXT NULL, kennung, gekoppelt_at,
  gekoppelt_von)` mit
  - `CHECK ((zugang_id IS NOT NULL AND instanz_kopplung_id IS NULL AND fremder_zugang_id IS NULL
    AND zugang_name IS NULL) OR (zugang_id IS NULL AND instanz_kopplung_id IS NOT NULL AND
    fremder_zugang_id IS NOT NULL AND zugang_name IS NOT NULL))`;
  - einem Teilindex `UNIQUE (zugang_id, kennung) WHERE zugang_id IS NOT NULL`;
  - einem Teilindex `UNIQUE (instanz_kopplung_id, fremder_zugang_id, kennung) WHERE
    instanz_kopplung_id IS NOT NULL`;
  - dem Index `idx_ortung_kopplung_einsatz`.
- Erzeugt `pub enum KopplungZugang { Lokal { zugang_id: String }, Hub { instanz_kopplung_id: i64,
  zugang_id: String } }` in `kopplung.rs`. `Kopplung.zugang_id: String` wird zu
  `Kopplung.zugang: KopplungZugang`, über `FromRow` von Hand oder über eine Zwischenzeile.
- Erzeugt `impl Kopplung { pub fn access_id(&self) -> &str }`, den Zugangs-Schlüssel beider Arten.

- [x] **Schritt 1: Failing Tests in `tests/ortung.rs`**
  - `gemischte_kopplungszeile_wird_abgelehnt`: Ein INSERT mit `zugang_id` **und**
    `instanz_kopplung_id` ergibt einen Fehler mit `CHECK`.
  - `hub_kopplung_wird_mit_namen_geladen`: Eine Hub-Zeile von Hand einfügen (Instanzkopplung über
    die vorhandenen Testhilfen oder per INSERT). `load_kopplung_tx` liefert `zugang_name` aus der
    Zeile und `KopplungZugang::Hub { .. }`.
  - `trennen_und_abschluss_sehen_hub_kopplungen`: `delete_kopplung_tx` liefert `Some(..)`;
    `beende_im_einsatz_tx` führt sie in `getrennt`.
- [x] **Schritt 2:** `cargo test --test ortung` muss mit FAIL enden (Spalte fehlt).
- [x] **Schritt 3: Migration 0387 schreiben**
  - Umbau nach dem Muster 0324: neue Tabelle anlegen, Bestand mit `zugang_id` kopieren, die alte
    Tabelle löschen, umbenennen, Indizes anlegen.
  - Kopfkommentar mit Verweis auf die Spec.
- [x] **Schritt 4: `SELECT_KOPPLUNG` umbauen**
  - `LEFT JOIN einwurf_zugang z ON z.id = k.zugang_id`;
  - Name `COALESCE(z.name, k.zugang_name)`;
  - die Hub-Spalten mitlesen.
  - `create_kopplung_tx` prüft „belegt“ nur unter lokalen Zeilen (`zugang_id = ?`).
  - `run_nachlauf` liest nur Zeilen mit `zugang_id IS NOT NULL`.
  - `From<Kopplung> for TrackingResponse` nimmt `access_id()`.
  - `disposition_repo.rs:796` füllt `OrtungVorzustand` aus `access_id()` (die Hub-Felder folgen in
    Task 4).
- [x] **Schritt 5:** `cargo test --test ortung`, dann `cargo test ortung`: PASS, auch
  `keine_tabelle_haelt_einen_positionsverlauf`.
- [x] **Schritt 6:** Commit `feat(ortung): Kopplung an Zugänge des Hubs vorbereiten (LLH-2119)`.

### Task 2: Hub beantwortet Ortungsanfragen im Abgleich

**Dateien:**
- Ändern: `src/instanz/spiegel/paket.rs`, mit neuen Feldern in `SpiegelPaket` und in `check()`
  (Grenze 200)
- Neu: `src/ortung/fern.rs` (in `src/ortung/mod.rs` als `pub mod fern;`)
- Ändern: `src/instanz/spiegel/abgleich.rs` (`handle_abgleich`, beide `SpiegelPaket { .. }`-
  Literale)
- Test: `tests/ortung_spiegel.rs` (neu, Testhilfen nach `tests/instanz_fuehrung.rs`:
  `instanz`, `gekoppelt`, `elw_meldet`, `abgleichen`, `elw_einsatz`; in eine kleine gemeinsame
  Hilfe kopieren oder `tests/instanz_hilfen` nutzen)

**Schnittstellen:**
- Erzeugt die Wire-Typen in `paket.rs` (alle `Serialize, Deserialize, Clone, Debug, PartialEq`):
  - `TrackingRequest { org: String, access_id: String, device_id: String }`;
  - `TrackingPosition { org: String, access_id: String, device_id: String, lat: f64, lon: f64,
    measured_at: String }`;
  - `TrackingCandidate { access_id: String, access_name: String, device_id: String,
    received_at: String }`, bewusst ohne Koordinaten;
  - `TrackingCandidates { org: String, tracking_enabled: bool, items: Vec<TrackingCandidate> }`.
- Erzeugt die Felder in `SpiegelPaket`, alle `#[serde(default)]`:
  - `tracking_requests: Vec<TrackingRequest>`;
  - `tracking_candidates_wanted: Vec<String>`;
  - `tracking_positions: Vec<TrackingPosition>`;
  - `tracking_candidates: Vec<TrackingCandidates>`.
- Erzeugt in `fern.rs`: `pub async fn answer_hub(pool: &SqlitePool, eigen: &Identitaet,
  kopplung: &KopplungZeile, anfrage: &SpiegelPaket) -> (Vec<TrackingPosition>,
  Vec<TrackingCandidates>)`.
  - Die Funktion ist fehlerfrei nach außen: Bei einem Fehler zählt sie eine Sammelzeile ohne
    Kennung und liefert leere Listen.
  - Die Org wird über `repo::list_orgs_aktiv(conn, kopplung.id)` und
    `org_kennung(&eigen.kennung, o.org_id)` aufgelöst, wie `org_wire` auf der erreichten Seite.
  - Kandidaten über `kopplung::list_kandidaten`; `tracking_enabled` aus
    `org::einstellungen::ortung_der_org`.

- [x] **Schritt 1: Failing Tests in `tests/ortung_spiegel.rs`.** Aufbau je Test:
  - Hub und ELW gekoppelt;
  - am Hub ein Einwurf-Zugang mit `positionen:write` für die abgebildete Org;
  - am Hub ein Einwurf über die Route mit Kennung `fkw1`;
  - Org-Schalter an.

  Der Hub-Teil wird direkt mit einem `SpiegelPaket` geprüft, das die Anfrage setzt (Aufruf
  `fern::answer_hub`).

  Tests:
  - `hub_liefert_position_nur_fuer_angefragte_kennung`: Angefragt wird `fkw1`; geliefert wird
    genau ein Eintrag mit `lat`/`lon` des Einwurfs. Eine zweite Kennung `fkw2` liegt vor, ist
    aber nicht angefragt und fehlt.
  - `hub_liefert_nichts_fuer_ungueltigen_zugang`: Für jede der folgenden Lagen ist
    `tracking_positions` leer, in einer Tabelle von Fällen in einem Test:
    - widerrufener Zugang;
    - abgelaufener Zugang;
    - Zugang mit `alarme:write`;
    - Zugang einer fremden Org;
    - Org-Kennung, die nicht abgebildet ist;
    - Org-Schalter aus.
  - `kandidaten_ohne_koordinaten`: Mit `tracking_candidates_wanted = [org]` stehen Einträge in
    `items`. Das serialisierte JSON von `TrackingCandidates` enthält weder `"lat"` noch `"lon"`.
  - `fehler_im_hub_teil_laesst_abgleich_leben`: `DROP TABLE position_letzte` im Hub-Pool, dann
    ein voller Abgleich über `abgleichen(elw)`. Er gelingt, und die Felder sind leer.
  - `aelteres_paket_ohne_felder_wird_gelesen`: JSON eines `SpiegelPaket` ohne die vier Felder
    deserialisiert, und die Felder sind leer.
- [x] **Schritt 2:** `cargo test --test ortung_spiegel` muss mit FAIL enden (Typen fehlen).
- [x] **Schritt 3:** Typen, Felder und `check()` umsetzen (`tracking_requests.len() <= 200` sonst
  kürzen, nicht abweisen: Überzählige überliest der Hub). `answer_hub` umsetzen.
  `handle_abgleich` ruft es **nach** dem `write_retry!` auf und setzt die Felder in die Antwort.
- [x] **Schritt 4:** `cargo test --test ortung_spiegel` und
  `cargo test --test eingabegrenzen_spiegel`: PASS.
- [x] **Schritt 5:** Commit `feat(spiegel): Hub liefert Positionen gekoppelter Kennungen (LLH-2119)`.

### Task 3: ELW fragt an und übernimmt

**Dateien:**
- Ändern: `src/ortung/fern.rs`, `src/ortung/uebernahme.rs`,
  `src/instanz/spiegel/abgleich.rs` (`abgleich_einmal`)
- Test: `tests/ortung_spiegel.rs`

**Schnittstellen:**
- Erzeugt `pub async fn build_requests(conn: &mut SqliteConnection, kopplung: &KopplungZeile)
  -> Result<(Vec<TrackingRequest>, Vec<String>), AppError>`:
  - Anfragen für alle Hub-Kopplungen dieser `instanz_kopplung_id` an aktiven Fahrzeugen aktiver,
    nicht gespiegelter Einsätze mit eingeschaltetem Org-Schalter;
  - `org` ist `o.fremde_org_kennung` der Org-Zeile zu `k.org_id`;
  - dazu die gewünschten Org-Kennungen aus dem Wunsch-Speicher.
- Erzeugt `pub async fn apply_answer(pool: &SqlitePool, kopplung: &KopplungZeile, antwort:
  &SpiegelPaket)`, fehlerfrei nach außen:
  - legt Kandidaten in den Puffer;
  - übernimmt jede Position in eigener `write_retry!`-Transaktion;
  - meldet danach live über `crate::instanz::stammdaten::live()` und
    `publiziere_objekt(einsatz_id, LiveEvent::Fahrzeug, "fahrzeug_id", ef_id)`.
- Erzeugt `pub async fn apply_remote_position_tx(conn, instanz_kopplung_id: i64, zugang_id: &str,
  kennung: &str, lat: f64, lon: f64, measured_at: &str, jetzt: &str) ->
  Result<Uebernahme, AppError>` in `uebernahme.rs`. Es teilt die Prüf- und Schreiblogik mit
  `apply_position_gedrosselt_tx` (gemeinsame innere Funktion mit fertiger Position) und merkt
  bei `Gedrosselt` **keinen** Nachlauf vor.
- Erzeugt den Puffer in `fern.rs`, prozessweit, Schlüssel `(pool-Adresse, instanz_kopplung_id,
  org_id)` nach dem Muster von `NachlaufKey`:
  - `pub fn wish_candidates(pool: &SqlitePool, instanz_kopplung_id: i64, org_id: i64)`, ein Wunsch
    für 60 s;
  - `pub fn cached_candidates(pool: &SqlitePool, instanz_kopplung_id: i64, org_id: i64) ->
    Option<(Instant, TrackingCandidates)>`.

- [x] **Schritt 1: Failing Tests.** Ende zu Ende über `abgleichen(elw)`. Das ELW führt den
  Einsatz (`elw_einsatz`) mit einem disponierten Fahrzeug. Die Hub-Kopplung wird per SQL
  eingefügt, die Route folgt in Task 4.
  - `elw_bekommt_position_vom_hub`: Nach `abgleichen` gilt am ELW-Fahrzeug `lat/lon` des
    Einwurfs und `position_quelle = 'einwurf'`. Nach einem zweiten `abgleichen` hat auch der
    Spiegel am Hub die Position.
  - `zweite_lieferung_binnen_15s_wird_gedrosselt`: Zweiter Einwurf mit Messzeit +5 s, dann
    `abgleichen`. Die Position bleibt die erste, und `is_nachlauf_vorgemerkt` ist `false`.
  - `aelterer_hub_ohne_felder`: Die Antwort ohne Felder ruft `apply_answer` direkt mit
    `SpiegelPaket::default()` auf. Nichts ändert sich, und es gibt keinen Panic.
  - `wunsch_liefert_kandidaten_in_den_puffer`: `wish_candidates`, dann `abgleichen`. Danach ist
    `cached_candidates` gesetzt und enthält `fkw1`.
- [x] **Schritt 2:** FAIL bestätigen.
- [x] **Schritt 3:** Umsetzen.
  - `abgleich_einmal` setzt die Anfragefelder in der ersten Runde, nur wenn
    `runde == 0`, damit ein Paket mit mehreren Runden nicht doppelt fragt.
  - Nach dem Commit der Antwortübernahme ruft es `apply_answer` auf.
- [x] **Schritt 4:** `cargo test --test ortung_spiegel --test ortung`: PASS.
- [x] **Schritt 5:** Commit `feat(ortung): ELW übernimmt Positionen vom Hub (LLH-2119)`.

### Task 4: Routen und Rücknahme am ELW

**Dateien:**
- Ändern: `src/routes/ortung.rs`, `src/ortung/kopplung.rs`, `src/public_api/zugang.rs`,
  `src/fahrzeug/mod.rs` (`OrtungVorzustand`), `src/fahrzeug/disposition_repo.rs`
  (`restore_ortung_tx`)
- Generiert: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`
- Test: `tests/ortung_spiegel.rs`

**Schnittstellen:**
- Erzeugt `pub async fn hub_kopplung_fuer_org(conn, org_id) -> Result<Option<(i64, String)>,
  AppError>` in `zugang.rs`: dieselbe Abfrage wie `hub_fuer_org`, sie liefert
  `(k.id, k.gegenueber_name)`.
- Erzeugt `pub async fn create_hub_kopplung_tx(conn, einsatz_id, ef_id, instanz_kopplung_id: i64,
  zugang_id: &str, zugang_name: &str, kennung: &str, benutzer_id, jetzt) ->
  Result<Kopplung, AppError>` in `kopplung.rs`.
  - Gleiche Prüfungen wie `create_kopplung_tx`, außer der Zugangsprüfung.
  - „belegt“ unter den Hub-Zeilen dieser Instanzkopplung gibt 409.
- `TrackingCandidates` (Route) bekommt `pending: bool`. `TrackingCandidate` (Route) bekommt
  `via_hub: bool`.
- `OrtungVorzustand` bekommt `#[serde(default)] instanz_kopplung_id: Option<i64>` und
  `#[serde(default)] zugang_name: Option<String>`. Mit gesetztem `instanz_kopplung_id` ist
  `zugang_id` der Hub-Zugang.

- [x] **Schritt 1: Failing Tests** über die Routen am ELW:
  - `kandidaten_vom_hub_mit_pending`:
    - Der erste GET liefert `pending: true` und eine leere Liste.
    - Nach `abgleichen` liefert der zweite GET `pending: false`, und `fkw1` steht mit
      `via_hub: true` und `coupled: false` darin.
  - `koppeln_an_hub_kennung`:
    - PUT mit `fkw1` antwortet 200.
    - Das ETB enthält „Ortung gekoppelt: … (<Zugangsname> / fkw1)“.
    - GET `…/tracking` liefert `access_name`.
    - Nach `abgleichen` steht die Position.
  - `koppeln_nicht_im_puffer_422`: PUT mit `fkw9` antwortet 422.
  - `doppelt_gekoppelt_409`: Ein zweites Fahrzeug mit `fkw1` antwortet 409.
  - `ruecknahme_stellt_hub_kopplung_her`: Entlassen, dann `…/stand-down/undo` mit dem
    gelieferten Vorzustand. Die Kopplung ist wieder da, auch nachdem der Puffer verfallen ist (der
    Test leert den Puffer).
  - `ohne_hub_bleibt_alles_lokal`: Eine Instanz ohne Hub liefert Kandidaten aus der eigenen
    Ablage mit `pending: false` und `via_hub: false`. Die bestehenden Tests in `tests/ortung.rs`
    bleiben grün.
- [x] **Schritt 2:** FAIL bestätigen.
- [x] **Schritt 3:** Umsetzen.
  - **`candidates`:** Hat die Org einen Hub, wird der Puffer gelesen. Ist er älter als 10 s oder
    fehlt er, folgen `wish_candidates` und `takt::wecken()`. `coupled` kommt aus den eigenen
    Hub-Zeilen; `tracking_enabled` ist das logische UND von Hub-Wert und eigenem Schalter.
  - **`couple`:** Hat die Org einen Hub, wird im Puffer nachgeschlagen (422
    `"Kennung nicht mehr verfügbar"`), dann `create_hub_kopplung_tx`, ohne `apply_position_tx`,
    danach `takt::wecken()`.
  - **`restore_ortung_tx`:** wählt die Art nach `instanz_kopplung_id`. Bei einer Hub-Kopplung
    gibt es keine Pufferprüfung, aber diese Prüfungen:
    - die Instanzkopplung ist aktiv;
    - die Org ist noch zugeordnet;
    - die Kennung ist frei.
  - Danach `scripts/check-typ-codegen.sh`.
- [x] **Schritt 4:** `cargo test --test ortung_spiegel --test ortung` und
  `scripts/check-typ-codegen.sh`: PASS.
- [x] **Schritt 5:** Commit `feat(ortung): Koppeln an Kennungen des Hubs (LLH-2119)`.

### Task 5: Führungsabgabe trennt still

**Dateien:**
- Ändern: `src/ortung/kopplung.rs`, `src/instanz/spiegel/fuehrung.rs` (`werde_spiegel`, neben
  Zeile 256)
- Test: `tests/ortung_spiegel.rs`

**Schnittstellen:**
- Erzeugt `pub async fn beende_bei_fuehrungsabgabe_tx(conn: &mut SqliteConnection, einsatz_id:
  i64) -> Result<u64, AppError>`. Sie löscht alle Kopplungen des Einsatzes, schreibt kein ETB und
  liefert die Anzahl.

- [x] **Schritt 1: Failing Tests**
  - `abgabe_trennt_hub_kopplung_still`:
    - Das ELW führt den Einsatz mit einer Hub-Kopplung und gibt die Führung an den Hub ab, über
      den Übergabeweg aus `tests/instanz_fuehrung.rs`.
    - Danach hat `ortung_kopplung` am ELW keine Zeile mehr.
    - Das ETB des Einsatzes enthält kein „Ortung getrennt“.
    - `einsatz_spiegel.bruch_offen = 0`.
  - `abgabe_am_hub_trennt_lokale_kopplung`: Der Hub führt mit einer lokalen Kopplung und gibt an
    das ELW ab. Die Zeile ist weg.
- [x] **Schritt 2:** FAIL bestätigen.
- [x] **Schritt 3:** Aufruf in `werde_spiegel` direkt nach
  `helfer::ende::beende_alle_im_einsatz`, mit Kommentar zur Bruchstelle (Spec, „Führungswechsel“).
- [x] **Schritt 4:** `cargo test --test ortung_spiegel --test instanz_fuehrung`: PASS.
- [x] **Schritt 5:** Commit `feat(ortung): Führungsabgabe beendet Kopplungen (LLH-2119)`.

### Task 6: Oberfläche

**Dateien:**
- Ändern: `frontend/src/kraefte/OrtungKoppelnDialog.tsx`,
  `frontend/src/kraefte/OrtungKoppelnDialog.test.tsx`, `frontend/src/pages/FahrzeugePage.tsx`
  (Marke am Spiegel), `frontend/src/pages/FahrzeugePage.test.tsx`

**Schnittstellen:**
- Verbraucht `pending` und `via_hub` aus `types.generated.ts` (Task 4).

- [x] **Schritt 1: Failing Tests (Vitest)**
  - `zeigt Ladezustand, solange der Hub liefert`: Bei `pending: true` steht der Text
    „Kennungen werden vom Hub geholt …“, und die Abfrage läuft erneut (`refetchInterval` 2000).
  - `zeigt Hinweis nach 15 s ohne Antwort`: Mit Fake-Timern und dauerhaft `pending` erscheint
    „Der Hub antwortet gerade nicht. Später erneut versuchen.“
  - `kennzeichnet Kennungen über den Hub`: Bei `via_hub: true` trägt die Zeile „über den Hub“.
  - FahrzeugePage `Spiegel zeigt Marke Ortung bei frischer Einwurf-Position`: Ein gespiegelter
    Einsatz mit `position_quelle: 'einwurf'` und Position jünger als 5 min zeigt die Marke
    „Ortung“; bei einer älteren Position fehlt sie. Die Schwelle kommt aus der bestehenden
    Konstante für „veraltet“, keine neue.
- [x] **Schritt 2:** `mise exec -- pnpm -C frontend vitest run src/kraefte/OrtungKoppelnDialog
  src/pages/FahrzeugePage` muss mit FAIL enden.
- [x] **Schritt 3:** Umsetzen.
  - `refetchInterval` nur bei offenem Dialog und `pending`.
  - Die 15 s ab dem ersten `pending` über einen Zeitstempel im State messen.
  - Texte wie oben.
- [x] **Schritt 4:** Tests PASS. Prettier und Lint über `./scripts/check-all.sh --geaendert
  --ohne-e2e` erst in Task 8.
- [x] **Schritt 5:** Commit `feat(fahrzeuge): Ortung über den Hub im Koppeldialog (LLH-2119)`.

### Task 7: ADR-0109 und Doku

**Dateien:**
- Neu: `docs/architektur/entscheidungen/ADR-0109-hub-liefert-positionen-nur-fuer-kennungen-die-das-fuehrende-elw-gekoppelt-hat.md`
  (Nummer vorher gegen `origin/alpha` prüfen)
- Ändern:
  - arc42, Kapitel 6 und 8, sowie die Tabelle nach `docs/architektur/AGENTS.md`;
  - `docs/anwender/…/fahrzeuge.md` und `anbindungen.md` (DSFA-Empfänger „führendes ELW“);
  - Spec LLH-2091, Abschnitt „Offen für später“: Verweis ergänzen.

- [x] **Schritt 1: ADR schreiben** nach `VORLAGE.md`.
  - `gilt_fuer`: `src/ortung/fern.rs`, `src/ortung/kopplung.rs`,
    `src/instanz/spiegel/fuehrung.rs`, `src/instanz/spiegel/paket.rs`.
  - Regeln wie in der Spec, „Doku“, einschließlich der Ausnahme „kein Nachlauf auf dem Hub-Weg“.
  - Prüfung:
    - `verlange 'beende_bei_fuehrungsabgabe_tx' src/instanz/spiegel/fuehrung.rs`
    - `verlange 'schreibe_position\(' src/ortung/uebernahme.rs`
    - `verbiete 'UPDATE einsatz_fahrzeug' src/ortung/fern.rs`
    - `verbiete 'tracing::' src/ortung/fern.rs`, mit Ausnahme der Sammelzeile über
      `SammelzeileJe`, ohne Kennung; das Muster danach ausrichten.
    - `verbiete '\b(lat|lon)\b'` im Typ `TrackingCandidate` (über einen eigenen Abschnitt oder
      einen Test).
- [x] **Schritt 2:** `scripts/adr-fuer.sh src/ortung/fern.rs` zeigt ADR-0109 und ADR-0103;
  `scripts/check-adr-nummern.sh` ist grün.
- [x] **Schritt 3:** Architektur- und Anwendertexte. Bilder nach `docs/anwender/AGENTS.md`
  (Bildlauf), soweit der Dialog betroffen ist.
- [x] **Schritt 4:** Commit `docs: ADR-0109 und Doku zur Ortung über den Hub (LLH-2119)`.

### Task 8: Gates, Bilder, Abschluss

- [x] **Schritt 1:** `./scripts/check-all.sh --geaendert --ohne-e2e`: alle Schritte grün,
  ohne `| tail`.
- [x] **Schritt 2:** Skill `verify` für die Fahrzeuge-Seite mit offenem Koppeldialog, um die
  Bilder der Änderung zu erzeugen.
- [x] **Schritt 3:** Plan abhaken. Push, PR gegen `alpha` mit Spec, Plan und Umsetzung,
  Zunder-Zeile und Bildern. Zunder auf `review` mit `pr_url`.
- [x] **Schritt 4:** Folgeaufgabe „Ortung bei Direktkopplung zweier ELW“ per
  `zunder-task-anlegen`.
