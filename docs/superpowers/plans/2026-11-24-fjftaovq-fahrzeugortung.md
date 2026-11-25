# Fahrzeugortung Implementation Plan (LLH-2091)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Eingeworfene Positionen (Scope `positionen:write`) bewegen gekoppelte Einsatzfahrzeuge
laufender Einsätze live auf der Lagekarte, mit Alter und Marke „veraltet“, ohne Verlauf.

**Architecture:** Neues Modul `src/ortung/` hält die Kopplung (`ortung_kopplung`) und die
Übernahme aus `position_letzte` nach `einsatz_fahrzeug`. Die Einwurf-Route ruft die Übernahme
nach ihrem Commit auf und verwirft deren Ergebnis; neue Einsatzrouten unter
`/api/incidents/{einsatz_id}/vehicles/{ef_id}/tracking` koppeln und trennen. Das Frontend zeigt
Quelle und Alter am Marker und koppelt über das Zeilenmenü der Fahrzeuge.

**Tech Stack:** Rust (axum, sqlx/SQLite, utoipa), React/TypeScript (TanStack Query, antd),
Vitest, Playwright-Bildlauf.

**Spec:** `docs/superpowers/specs/2026-11-24-fjftaovq-fahrzeugortung-design.md` (freigegeben
24.11.2026). Jede Aufgabe liest den Abschnitt „Entwurf“ dort mit.

## Global Constraints

- Veraltet strikt über 10 Minuten: `ORTUNG_VERALTET_NACH_MIN = 10`.
- Drossel 15 Sekunden je Fahrzeug, mit genau einem Nachlauf: `ORTUNG_DROSSEL_S = 15`.
- Kandidaten: Kennungen mit `empfangen_at` in den letzten 24 h, nicht widerrufene Zugänge mit
  `positionen:write` der eigenen Org, ohne Koordinaten.
- Vorrang über `position_gesetzt_at` (Serverzeit); Alter über `position_gemessen_at`.
- Kein Verlauf: keine Tabelle mit mehr als einem Wert je Fahrzeug bzw. je Kennung.
- Antwort des Einwurfs bleibt 204 bzw. wie heute, unabhängig von Kopplung und Übernahme.
- Routen unter `/api/incidents/…` (ADR-0097, Wächter `scripts/check-api-routen.sh`); neue
  Glossar-Zeilen `candidates	Kandidaten` und `tracking	Ortung`, sortiert.
- Wire-Felder neuer Request/Response-Typen englisch; neue Felder in `EinsatzFahrzeugAnzeige`
  deutsch: `position_quelle`, `position_gemessen_at`, `ortung_gekoppelt`.
- Bezeichner: Fachbegriffe deutsch, Abläufe englisch (`load_kopplung`, `apply_position`).
- Prosa, ETB-Texte, Tests als Sätze: deutsch.
- ETB-Texte exakt: „Ortung gekoppelt: {funkrufname} ({zugang_name} / {kennung})“, mit Zusatz
  „, Besatzung ehrenamtlich bestätigt“; „Ortung getrennt: {funkrufname}“.
- Org-Schalter-Text: „Ortung auch bei hauptamtlicher Besatzung“, Zustandszeile „Nur mit
  Betriebs- oder Dienstvereinbarung (§ 87 Abs. 1 Nr. 6 BetrVG).“
- Kein `tracing` mit Kennung, Schlüssel oder Koordinaten (ADR-0023-Prüfung auf `routen.rs`).
- Live nach dem Commit, außerhalb `write_retry!`.
- Abweichung vom Entwurf (Entscheidung beim Bauen): die Übernahme nach dem Einwurf läuft
  **awaited** im Handler statt per `tokio::spawn`, Fehler verworfen; nur der Nachlauf ist ein
  `tokio::spawn`. Grund: deterministisch testbar, Antwort unverändert.

## Review Focus

1. Kennung an Fahrzeug A gekoppelt, A wird entlassen, Kennung an B gekoppelt, dann „Rückgängig“
   bei A: A bleibt getrennt, B behält die Kopplung (Test in Task 6).
2. Einwurf für eine Kennung, deren Fahrzeug in einem inzwischen abgeschlossenen Einsatz hängt
   (Kopplung trotz Abschluss noch da, etwa durch Wettlauf): kein UPDATE, Antwort 204 (Task 4).
3. Zugang widerrufen, Kopplung bleibt: Kandidaten zeigen ihn nicht mehr, Übernahme schreibt
   nichts mehr, weil kein Einwurf ankommt (Task 5, Kandidatentest).
4. Manuell gelöschte Position (`lat/lon = null`) an einem gekoppelten Fahrzeug: der nächste Fix
   setzt sie wieder (Quelle und Zeiten NULL zählen als „älter“) (Task 3).
5. Kopplung per PUT an einem Fahrzeug eines gespiegelten Einsatzes: 409, kein ETB (Task 5).

---

### Task 1: Datenmodell, Positionsquelle, manuelle Route

**Files:**
- Create: `migrations/0373_fahrzeugortung.sql` (Nummer vor dem Commit mit
  `scripts/check-migrationen.sh` prüfen)
- Modify: `src/fahrzeug/mod.rs` (`EinsatzFahrzeugAnzeige`), `src/fahrzeug/disposition_repo.rs`
  (`SELECT_AUFGELOEST`, `Row`, `zu_anzeige`, `update_position`), `tests/enum_wire_kontrakt.rs`
- Create: `src/ortung/mod.rs` (nur `PositionQuelle` in dieser Aufgabe), `src/lib.rs` (`pub mod ortung;`)
- Generated: `frontend/src/api/types.generated.ts` und Schwester per `scripts/check-typ-codegen.sh`
- Test: `tests/einsatz_fahrzeug.rs`

**Interfaces:**
- Produces: Tabelle `ortung_kopplung` (Spalten wie Entwurf, `UNIQUE (zugang_id, kennung)`),
  Spalten `einsatz_fahrzeug.position_quelle|position_gemessen_at|position_gesetzt_at`,
  `org_einstellungen.ortung_hauptamt`. `wire_enum! PositionQuelle { Manuell => "manuell",
  Ortung => "ortung" }` in `crate::ortung`. Anzeige-Felder `position_quelle:
  Option<PositionQuelle>`, `position_gemessen_at: Option<String>`, `ortung_gekoppelt: bool`
  (aus `EXISTS (SELECT 1 FROM ortung_kopplung k WHERE k.einsatz_fahrzeug_id = ef.id)`).

- [x] **Step 1: Failing tests** in `tests/einsatz_fahrzeug.rs`:
  `manuelle_position_setzt_quelle_und_zeiten` (PATCH lat/lon → Antwort `position_quelle ==
  "manuell"`, `position_gemessen_at` gesetzt, in der DB `position_gesetzt_at ==
  position_gemessen_at`); `geloeschte_position_leert_quelle_und_zeiten` (PATCH null/null → beide
  Felder fehlen/null, DB alle drei NULL); `nur_tz_felder_aendern_die_quelle_nicht` (PATCH nur
  `tz_fachaufgabe` → Quelle bleibt wie vorher); `anzeige_traegt_keine_kennung` (JSON von
  `GET …/vehicles` enthält weder `kennung` noch `zugang`, `ortung_gekoppelt == false`).
  Enum-Kontrakt-Eintrag für `PositionQuelle`.
- [x] **Step 2:** `cargo test --test einsatz_fahrzeug position` → FAIL (Felder fehlen).
- [x] **Step 3:** Migration schreiben. Bestand: `UPDATE einsatz_fahrzeug SET position_quelle =
  'manuell' WHERE lat IS NOT NULL`. `CHECK (position_quelle IN ('manuell','ortung'))`. Index
  `ortung_kopplung(einsatz_id)`. `update_position`: setzt nur, wenn `lat` oder `lon` im Patch
  stehen, `position_quelle = CASE WHEN neue lat IS NULL THEN NULL ELSE 'manuell' END` und beide
  Zeiten auf `zeit::jetzt()` bzw. NULL. Codegen laufen lassen.
- [x] **Step 4:** `cargo test --test einsatz_fahrzeug && cargo test --test enum_wire_kontrakt &&
  scripts/check-typ-codegen.sh` → PASS.
- [x] **Step 5:** Commit `feat(ortung): Positionsquelle und Kopplungstabelle (LLH-2091)`.

### Task 2: Org-Schalter `ortung_hauptamt`

**Files:**
- Modify: `src/org/einstellungen.rs` (`OrgEinstellungen`, Anzeige, `speichern`),
  `src/routes/org_einstellungen.rs`, ggf. `src/instanz/stammdaten/art.rs` (Spalte ausdrücklich
  als lokal führen, falls ein Wächter jede Spalte verlangt)
- Test: `tests/org_einstellungen.rs`

**Interfaces:**
- Produces: `OrgEinstellungen.ortung_hauptamt: Option<i64>`, `pub fn
  is_ortung_hauptamt(&self) -> bool` (nur `Some(1)` ist an). Wire-Feld `ortung_hauptamt`.

- [x] **Step 1: Failing tests:** `ortung_hauptamt_ist_standardmaessig_aus` (GET ohne Zeile →
  `false`/null), `nur_admin_schaltet_ortung_hauptamt` (Führungskraft PUT → 403, Admin → 200 und
  `admin_audit`-Zeile), `ortung_hauptamt_geht_nicht_in_die_stammdaten` (die Liste der
  synchronisierten Spalten enthält ihn nicht).
- [x] **Step 2:** `cargo test --test org_einstellungen ortung` → FAIL.
- [x] **Step 3:** Feld durchreichen wie `auto_etb_eintraege`; Codegen.
- [x] **Step 4:** Tests + `scripts/check-typ-codegen.sh` → PASS.
- [x] **Step 5:** Commit `feat(ortung): Org-Schalter für hauptamtliche Besatzung (LLH-2091)`.

### Task 3: Übernahme mit Vorrang, Drossel und Nachlauf

**Files:**
- Create: `src/ortung/uebernahme.rs`
- Modify: `src/ortung/mod.rs`, `src/app.rs`/`AppState` nur falls der Nachlauf-Speicher dort
  hängen muss (bevorzugt `static` in `uebernahme.rs`)
- Test: `tests/ortung.rs` (neu; Fixture: Org, Admin, Einsatz, disponiertes Fahrzeug, Zugang
  `positionen:write`, Kopplungszeile per SQL)

**Interfaces:**
- Consumes: Tabellen aus Task 1, `position_letzte`.
- Produces:
  - `pub const ORTUNG_DROSSEL_S: i64 = 15;`
  - `pub enum Uebernahme { Geschrieben { einsatz_id: i64, ef_id: i64 }, Gedrosselt { ef_id:
    i64 }, Nichts }`
  - `pub async fn apply_position_tx(conn: &mut SqliteConnection, zugang_id: &str, kennung: &str,
    jetzt: &str) -> Result<Uebernahme, AppError>`: lädt Kopplung ⨝ aktives Fahrzeug ⨝ Einsatz
    `status = 'aktiv' AND spiegel = 0` ⨝ `position_letzte`; Vorrang
    `position_letzte.empfangen_at > COALESCE(ef.position_gesetzt_at, '')`; Drossel, wenn
    `ef.position_quelle = 'ortung'` und `jetzt - ef.position_gesetzt_at < 15 s`.
  - `pub async fn apply_position(state: &AppState, zugang_id: &str, kennung: &str)`: eigener
    `write_retry!`, danach bei `Geschrieben` `live.publiziere_objekt(…Fahrzeug…)`, bei
    `Gedrosselt` `schedule_nachlauf(state, zugang_id, kennung, ef_id)`; Fehler → `SammelzeileJe`
    ohne Kennung, kein Rückgabewert.
  - `pub fn is_nachlauf_vorgemerkt(ef_id: i64) -> bool` (Test-Hook) und
    `async fn run_nachlauf(…)` hinter `tokio::time::sleep(ORTUNG_DROSSEL_S)`.

- [x] **Step 1: Failing tests** (`apply_position_tx` direkt, mit Zeitstempeln):
  `gekoppelte_kennung_schreibt_position_und_quelle_ortung`;
  `ohne_kopplung_aendert_nichts`; `beendetes_fahrzeug_aendert_nichts`;
  `abgeschlossener_einsatz_aendert_nichts`; `gespiegelter_einsatz_aendert_nichts`;
  `manuelle_position_bleibt_bis_ein_spaeter_empfangener_fix_kommt` (manuell `gesetzt_at =
  T`, Fix mit `empfangen_at = T-1s` → `Nichts`; `T+1s` → `Geschrieben`);
  `vorgehende_geraeteuhr_aendert_den_vorrang_nicht` (`gemessen_at` in der Zukunft der Serverzeit,
  `empfangen_at` vor manuell → `Nichts`); `geloeschte_position_wird_vom_naechsten_fix_gesetzt`;
  `zweiter_fix_binnen_15_s_wird_gedrosselt` (→ `Gedrosselt`, DB unverändert);
  `nachlauf_schreibt_die_juengste_position` (nach `Gedrosselt` mit `jetzt + 15 s` erneut →
  `Geschrieben` mit den Koordinaten des zweiten Fixes).
- [x] **Step 2:** `cargo test --test ortung` → FAIL.
- [x] **Step 3:** Implementieren; Nachlauf-Menge als `static Mutex<HashSet<i64>>`, Eintrag beim
  Vormerken, Entfernen nach dem Lauf.
- [x] **Step 4:** `cargo test --test ortung` → PASS.
- [x] **Step 5:** Commit `feat(ortung): Übernahme eingeworfener Positionen (LLH-2091)`.

### Task 4: Einwurf stößt die Übernahme an

**Files:**
- Modify: `src/public_api/einwurf/routen.rs:165-183`
- Test: `tests/ortung.rs`

**Interfaces:** Consumes `ortung::uebernahme::apply_position(&state, &zugang.id, &inhalt.kennung)`.

- [x] **Step 1: Failing tests** über den echten Einwurf (`GET /api/v1/intake/{key}/position?id=…&lat=…&lon=…`, Helfer wie `tests/einwurf.rs`):
  `einwurf_mit_gekoppelter_kennung_bewegt_das_fahrzeug_und_meldet_live` (204, DB lat/lon, ein
  `fahrzeug`-Ereignis am Live-Hub abonniert); `einwurf_ohne_kopplung_antwortet_gleich`
  (204, Fahrzeug unverändert, gleiche Header); `einwurf_nach_abschluss_aendert_kein_fahrzeug`
  (Kopplungszeile per SQL nach Abschluss erzwungen → 204, keine Änderung);
  `aelterer_fix_stoesst_nichts_an` (`Aelter` → kein Ereignis).
- [x] **Step 2:** `cargo test --test ortung einwurf` → FAIL.
- [x] **Step 3:** Nach dem `write_retry!` bei `PositionErgebnis::Uebernommen`
  `crate::ortung::uebernahme::apply_position(&state, &zugang.id, &inhalt.kennung).await;`.
- [x] **Step 4:** `cargo test --test ortung && cargo test --test einwurf && scripts/check-architektur.sh`
  → PASS.
- [x] **Step 5:** Commit `feat(ortung): Einwurf stößt die Übernahme an (LLH-2091)`.

### Task 5: Koppeln, Trennen, Kandidaten (Routen)

**Files:**
- Create: `src/ortung/kopplung.rs`, `src/routes/ortung.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs` (vier Routen), `scripts/api-routen-woerter.tsv`,
  `src/fahrzeug/mod.rs` (ETB-Textfunktionen neben `etb_text_disponiert`)
- Test: `tests/ortung.rs`

**Interfaces:**
- Produces (Repo, alle `_tx` in der Transaktion des Aufrufers):
  - `pub struct Kopplung { einsatz_fahrzeug_id: i64, einsatz_id: i64, zugang_id: String,
    zugang_name: String, kennung: String, ehrenamt_bestaetigt: bool, gekoppelt_at: String }`
  - `load_kopplung_tx(conn, einsatz_id, ef_id) -> Result<Option<Kopplung>, AppError>`
  - `create_kopplung_tx(conn, einsatz_id, ef_id, zugang_id, kennung, ehrenamt_bestaetigt,
    benutzer_id, jetzt) -> Result<Kopplung, AppError>` (409 bei belegter Kennung an anderem
    Fahrzeug; ersetzt die eigene)
  - `delete_kopplung_tx(conn, einsatz_id, ef_id) -> Result<Option<Kopplung>, AppError>`
  - `delete_kopplungen_einsatz_tx(conn, einsatz_id) -> Result<Vec<(i64, Kopplung)>, AppError>`
  - `list_kandidaten(pool, org_id, jetzt) -> Result<Vec<Kandidat>, AppError>`
  - `pub fn etb_text_gekoppelt(funkrufname, zugang_name, kennung, ehrenamt: bool) -> String`,
    `pub fn etb_text_getrennt(funkrufname) -> String`
- Routes (Gate `EinsatzSchreibzugriff<Fahrzeuge>`), Wire englisch:
  - `GET /api/incidents/{einsatz_id}/vehicles/{ef_id}/tracking` → `TrackingResponse { access_id,
    access_name, device_id, coupled_at, volunteer_crew_confirmed }` oder 404
  - `GET …/tracking/candidates` → `Vec<TrackingCandidate { access_id, access_name, device_id,
    received_at, coupled }>`
  - `PUT …/tracking` Body `TrackingRequest { access_id, device_id, volunteer_crew_confirmed:
    bool }` → `EinsatzFahrzeugAnzeige`
  - `DELETE …/tracking` → 204
- Fehler: 409 Einsatz nicht aktiv / gespiegelt / Fahrzeug beendet / Kennung belegt; 422 Zugang
  fremd oder falscher Scope; 422 Code `volunteer_crew_required`, wenn Schalter aus und nicht
  bestätigt.

- [x] **Step 1: Failing tests:** `koppeln_schreibt_etb_und_uebernimmt_vorhandene_position`;
  `koppeln_ohne_bestaetigung_bei_ausgeschaltetem_schalter_ist_422`;
  `koppeln_ohne_bestaetigung_bei_eingeschaltetem_schalter_geht`;
  `belegte_kennung_ist_409`; `koppeln_im_gespiegelten_einsatz_ist_409_ohne_etb`;
  `fremder_oder_falscher_zugang_ist_422`; `lesende_rolle_darf_nicht_koppeln` (403);
  `trennen_schreibt_etb_und_laesst_die_position_stehen`;
  `kandidaten_ohne_koordinaten_ohne_fremde_org_ohne_widerrufene_und_ohne_alte`
  (Zeile 25 h alt fehlt; JSON-Schlüssel ohne `lat`/`lon`); `routen_waechter_ist_gruen`
  (`scripts/check-api-routen.sh` im Gate, nicht als Rust-Test).
- [x] **Step 2:** `cargo test --test ortung kopp` → FAIL.
- [x] **Step 3:** Implementieren; ETB über `crate::etb::system_audit_tx`, danach
  `state.live.publiziere(einsatz_id, etb_id)` und `sse_fahrzeug`; nach dem Koppeln
  `apply_position_tx` in derselben Transaktion. Glossar ergänzen, utoipa nur falls die
  Einsatzrouten es führen.
- [x] **Step 4:** `cargo test --test ortung && scripts/check-api-routen.sh &&
  scripts/check-typ-codegen.sh` → PASS.
- [x] **Step 5:** Commit `feat(ortung): Koppeln und Trennen im Einsatz (LLH-2091)`.

### Task 6: Lebenszyklus — Entlassen, Stornieren, Abschluss, Rückgängig

**Files:**
- Modify: `src/fahrzeug/disposition_repo.rs` (`entlassen_tx`, `stornieren_tx`,
  `zuruecknehmen_tx`), `src/fahrzeug/mod.rs` (`EntlassungVorzustand.ortung:
  Option<OrtungVorzustand>`), `src/routes/einsatz_fahrzeug.rs` (ETB-Text beim Entlassen,
  Stornieren, Rückgängig), `src/einsatz/repo.rs` (`abschliessen`)
- Test: `tests/ortung.rs`

**Interfaces:**
- Consumes: `delete_kopplung_tx`, `delete_kopplungen_einsatz_tx`, `create_kopplung_tx`,
  `etb_text_getrennt`.
- Produces: `pub struct OrtungVorzustand { zugang_id: String, kennung: String,
  ehrenamt_bestaetigt: bool }` (`#[serde(default)]` am Feld). `Entlassen.ortung:
  Option<Kopplung>`; `Ruecknahme.ausgelassen` bekommt den Eintrag „Ortung“, wenn sie nicht
  zurückkommt.

- [x] **Step 1: Failing tests:** `entlassen_trennt_die_ortung_mit_etb`;
  `stornieren_trennt_die_ortung_mit_etb`;
  `abschluss_trennt_alle_kopplungen_und_loescht_gps_positionen_aber_keine_manuellen`;
  `rueckgaengig_nach_entlassen_stellt_die_kopplung_her`;
  `rueckgaengig_laesst_die_kopplung_aus_wenn_die_kennung_inzwischen_belegt_ist` (Review Focus 1);
  `rueckgaengig_prueft_zugang_der_org` (fremder `zugang_id` im Vorzustand → ausgelassen);
  `wiedereroeffnen_stellt_keine_kopplung_her`.
- [x] **Step 2:** `cargo test --test ortung lebens` bzw. die Namen → FAIL.
- [x] **Step 3:** Implementieren. Abschluss: im bestehenden Abschluss-tx nur bei
  `rows_affected() == 1`: Kopplungen löschen, je Fahrzeug ETB „Ortung getrennt“, dann `UPDATE
  einsatz_fahrzeug SET lat = NULL, lon = NULL, position_quelle = NULL, position_gemessen_at =
  NULL, position_gesetzt_at = NULL WHERE einsatz_id = ? AND position_quelle = 'ortung'`; die
  ETB-IDs in `etb_eintrag_ids` anhängen. Rückgängig: Ehrenamt-Bedingung erneut wie beim PUT.
- [x] **Step 4:** `cargo test --test ortung && cargo test --test einsatz_fahrzeug && cargo test
  --test einsatz` (bzw. die Abschluss-Suite) → PASS.
- [x] **Step 5:** Commit `feat(ortung): Kopplung endet mit dem Fahrzeug und dem Einsatz (LLH-2091)`.

### Task 7: ADR-0098 und Verlaufs-Wächter

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0098-ortung-uebernimmt-positionen-nur-fuer-gekoppelte-fahrzeuge-laufender-einsaetze.md` (Vorlage `VORLAGE.md`, unter 80 Zeilen, `gilt_fuer: src/ortung/**, src/routes/ortung.rs`, `herleitung:` Design-Doc)
- Test: `tests/ortung.rs` (`keine_tabelle_haelt_einen_positionsverlauf`: über `sqlite_master`
  jede Tabelle mit Spalten `lat` und `lon` hat einen eindeutigen Schlüssel, der höchstens eine
  Zeile je Fahrzeug bzw. Kennung erlaubt; erlaubte Liste ausdrücklich im Test)

- [x] **Step 1:** Test schreiben, laufen lassen; er muss mit der erlaubten Liste grün sein und
  rot werden, wenn man testweise eine Tabelle `ortung_verlauf(lat, lon, …)` anlegt (Mutationsprobe,
  nicht committen).
- [x] **Step 2:** ADR schreiben: Regeln aus Entwurf „Doku“; Prüfung u. a.
  `verlange 'apply_position' src/public_api/einwurf/routen.rs`,
  `verbiete 'tracing::' src/ortung/`, `verlange "spiegel = 0" src/ortung/uebernahme.rs`.
- [x] **Step 3:** `scripts/adr-fuer.sh src/ortung/uebernahme.rs` nennt ADR-0098 und ADR-0023;
  `scripts/check-architektur.sh` grün.
- [x] **Step 4:** Commit `docs(adr): ADR-0098 Ortung nur für gekoppelte Fahrzeuge (LLH-2091)`.

### Task 8: Frontend — Koppeln im Zeilenmenü der Fahrzeuge

**Files:**
- Create: `frontend/src/kraefte/OrtungKoppelnDialog.tsx`, `…/OrtungKoppelnDialog.test.tsx`,
  `frontend/src/api/ortung.ts`
- Modify: `frontend/src/pages/FahrzeugePage.tsx` (`zeilenEintraege`, `handleZeilenAktion`, Marke
  „GPS“ in der Zeile), `frontend/src/api/queryKeys.ts` (`einsatzKeys.ortungKandidaten(einsatzId,
  efId)` in `NICHT_LIVE_KEYS`), Offline-Klassifikation (`LAGEBILD_OFFLINE` ausdrücklich ohne
  Kandidaten)

**Interfaces:**
- Produces: `listOrtungKandidaten(einsatzId, efId): Promise<TrackingCandidate[]>`,
  `koppleOrtung(einsatzId, efId, body: TrackingRequest)`, `trenneOrtung(einsatzId, efId)` gegen
  `/api/incidents/…`. Org-Schalter aus `useOrgEinstellungen()` (bestehender Hook) →
  `ortung_hauptamt`.

- [x] **Step 1: Failing tests:** Dialog zeigt Kandidaten als „{Zugang} · {Kennung} · vor 2 min“,
  gekoppelte deaktiviert; bei Schalter aus ist „Besatzung ist ehrenamtlich“ Pflicht (Absenden
  gesperrt bis angehakt), bei an nicht sichtbar; ohne Kandidaten der Satz „Keine Position in den
  letzten 24 Stunden eingegangen.“; Menü zeigt „Ortung koppeln …“ bzw. „Ortung trennen“ je nach
  `ortung_gekoppelt`, nicht ohne Schreibrecht.
- [x] **Step 2:** `mise exec -- pnpm -C frontend vitest run OrtungKoppelnDialog FahrzeugePage` → FAIL.
- [x] **Step 3:** Implementieren nach `FahrzeugAngabenDialog`; Alter über `anzeige/dauer.ts`.
- [x] **Step 4:** Tests, `pnpm -C frontend lint`, `tsc` → PASS.
- [x] **Step 5:** Commit `feat(ortung): Ortung im Einsatz koppeln (LLH-2091)`.

### Task 9: Frontend — Lagekarte zeigt Quelle und Alter

**Files:**
- Create: `frontend/src/pages/lagekarte/ortungAlter.ts` (+ `.test.ts`)
- Modify: `frontend/src/pages/lagekarte/marker.ts` (Fahrzeugschleife), `markerLayer.ts` (Marke),
  `leistenDaten.ts` (`auswahlRaster`, Zeile „Position“)

**Interfaces:**
- Produces: `export const ORTUNG_VERALTET_NACH_MIN = 10;`
  `export function ortungStand(f: Pick<EinsatzFahrzeug,'position_quelle'|'position_gemessen_at'>,
  jetzt: Date): { quelle: 'gps' | 'manuell' | null; veraltet: boolean; alterText: string | null }`.

- [x] **Step 1: Failing tests:** 10 min genau → nicht veraltet, 10 min + 1 s → veraltet;
  manuell nie veraltet und ohne Alter; Raster-Text „GPS · vor 3 min“, „GPS · veraltet · vor 14
  min“, „manuell“; Marker eines GPS-Fahrzeugs trägt die Marke „GPS“, veraltet zusätzlich in
  Worten; Live-Update ruft keine Kamerafahrt (`AUTOMATISCH`) auf.
- [x] **Step 2:** `mise exec -- pnpm -C frontend vitest run ortungAlter marker leistenDaten` → FAIL.
- [x] **Step 3:** Implementieren; Takt `useMinutenTakt`; Farben aus `rollen.achtungText` wie
  `FachebeneStand`; Trefferzone und Status-Ring unverändert.
- [x] **Step 4:** Tests, Lint → PASS.
- [x] **Step 5:** Commit `feat(ortung): Lagekarte zeigt GPS und veraltet (LLH-2091)`.

### Task 10: Frontend — Org-Schalter bei Anbindungen

**Files:** Modify `frontend/src/pages/einstellungen/Anbindungen.tsx` (oder
`EinwurfZugaenge.tsx`), Test daneben.

- [x] **Step 1: Failing test:** Schalter mit Text und Zustandszeile aus „Global Constraints“,
  speichert `ortung_hauptamt: 1/0` über `PUT /api/org-settings`, nur für Admin bedienbar.
- [x] **Step 2–4:** rot → implementieren nach `EinsatzKennzahlen.tsx:76-112` → grün, Lint.
- [x] **Step 5:** Commit `feat(ortung): Schalter für hauptamtliche Besatzung (LLH-2091)`.

### Task 11: Doku — Architektur und Anwender

**Files:** `docs/architektur/05-bausteinsicht.md`, `06-laufzeitsicht.md` (neuer Abschnitt nach
§6.6e), `08-querschnittliche-konzepte.md`, `11-risiken-und-technische-schulden.md`,
`12-glossar.md` („Ortung“, „Kopplung (Ortung)“); `docs/anwender/kapitel/anbindungen.md` (Ortung
einrichten, Schalter, DSFA-Vorlage), `lagekarte.md`, `fahrzeuge.md`; Bilder per
`pnpm doku:bilder --grep <kapitel>` nach `docs/anwender/AGENTS.md`.

- [x] **Step 1:** Kapitel schreiben; jede Aussage durch Code gedeckt. DSFA-Vorlage: Zweck,
  Rechtsgrundlage (Platzhalter, Art. 6 DSGVO für das Ehrenamt, Betriebs-/Dienstvereinbarung für
  das Hauptamt), Speicherdauer (Ablage 24 h, am Fahrzeug bis zum Abschluss), kein Verlauf,
  Empfänger (Einsatzkräfte mit Zugriff, Spiegel-Instanzen), TOM.
- [x] **Step 2:** Doku-Wächter aus `check-all.sh` (Bündel `schnell`) → grün.
- [x] **Step 3:** Commit `docs(ortung): Architektur- und Anwenderkapitel (LLH-2091)`.

### Task 12: Gesamtprüfung

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` → grün; Ergebnis für den PR notieren.
- [ ] Prüfstein von Hand: `curl "https://…/api/v1/intake/<key>/position?id=fuekw&lat=52.52&lon=13.40"`
  gegen den lokalen Stack (mit Schalter für TLS-Ausnahme), Marker bewegt sich.
- [x] Folgeaufgabe „Ortung in gespiegelten Einsätzen“ (LLH-2119; dazu LLH-2120 admin_audit) auf dem Board anlegen
  (`zunder-task-anlegen`).
