# Helfer-App Stufe 2 (Pager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aufträge an Einheit, Fahrzeug oder zugeordnete Person erreichen die bestätigte Helfer-App auch bei geschlossener App; „Übernommen“ schreibt die Quittung an die Empfängerzeile.

**Architecture:** Der Server bestimmt beim Erteilen und Berichtigen die Pager-Empfänger (`helfer::pager`), zählt sie an der Empfängerzeile, meldet sie kopplungsgenau über den Live-Kanal (Android-Dienst hört mit) und schickt iOS-Push verschlüsselt über das Relais mit `thema` = Helfer-Bundle. Die Apps lesen ihre Aufträge über `GET /api/devices/me/tasks` und quittieren über eine eigene Route, die denselben Quittungsablauf wie die Einheitenansicht nutzt.

**Tech Stack:** Rust (axum, sqlx/SQLite), Push-Relais (Rust, APNs), React/TS (Leitung), SwiftUI + Swift-Paket `HelferKern`, Compose + Kotlin-Modul `helferkern`.

**Spec:** `docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md`

## Global Constraints

- Pager-Empfänger = `ansicht='helfer' AND helfer_zustand='aktiv' AND widerrufen_at IS NULL AND laeuft_ab_at > datetime('now')`, Einsatz `status='aktiv' AND geloescht_at IS NULL`, nicht gespiegelt (`nicht_gespiegelt`). Pausiert/ruhend zählt mit; `unbestaetigt` nie.
- Eigene Zeile: `einheit`↔`einheit_id`, `fahrzeug`↔`fahrzeug_id`, `person`↔`person_id` (nur wenn gesetzt). Abschnitt, Funktion, extern nie.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“); neue Wire-Typen englische Felder; Routen nach `scripts/api-routen-woerter.tsv`.
- Relais-Wire deutsch und additiv (`push-relais/AGENTS.md`); Token und Nutzlast nie loggen.
- iOS-Nutzlast: AES-256-GCM, AAD = Kennung, Umschlag wie `src/ios_push/krypto.rs`; Stufe `alarm` (zeitkritisch).
- Helfer-Bundle `dev.rubeen.lifeline.helfer`, Mitteilungsdienst `dev.rubeen.lifeline.helfer.dienst`, App Group `group.dev.rubeen.lifeline.helfer`.
- Android: kein FCM, kein `ACCESS_BACKGROUND_LOCATION`, `START_NOT_STICKY`, Dienst startet nur aus dem Vordergrund; Typen `location|remoteMessaging`.
- Logik in den Kernen mit Tests; jeder neue Bildschirm Testzustand + Bild (`ios/Helfer/AGENTS.md`, `android/helfer/AGENTS.md`).
- Texte (wörtlich): „Übernommen“, „Keine Aufträge. Neue Aufträge kommen als Mitteilung.“, „Mitteilungen aus — du bekommst Aufträge nur bei offener App“, „Bitte über Funk bestätigen“, „an n Helfer-Apps gesendet“, „(Helfer-App)“, Android-Sperrbildschirm „Neuer Auftrag“, Dienst „empfängt Aufträge“, „Ortung wartet — App öffnen“.
- Statuscodes nach `src/AGENTS.md`, „Statuscode-Konvention“.

## Review Focus

1. Einsatz endet, während ein Auftrag erteilt wird: kein Live, kein Push nach dem Ende — Test in Task 6.
2. Helfer ist an Einheit gebunden **und** als Person Empfänger desselben Auftrags: genau eine Mitteilung, beide Zeilen in der Liste — Test in Task 6.
3. Zwei Helfer derselben Einheit quittieren gleichzeitig: eine Quittung, die zweite sieht „Übernommen von …“ — Test in Task 4.
4. Quittung eines aufgehobenen Auftrags aus der App: 422, App zeigt „aufgehoben“ — Tests in Task 4 und Task 10/12.
5. Relais ohne `thema`-Unterstützung bzw. fremdes `thema`: Lifeline-App-Push bleibt unverändert, fremdes Thema 422 ohne APNs — Test in Task 2.

---

### Task 1: ADR-0104, Regeln und Prüfungen

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0104-die-helfer-app-empfaengt-auftraege-nur-fuer-eine-bestaetigte-kopplung.md` (nach `VORLAGE.md`)
- Modify: `docs/architektur/entscheidungen/ADR-0101-…md` (Verweis „ergänzt durch ADR-0104“), `ios/Helfer/AGENTS.md`, `android/helfer/AGENTS.md`, `push-relais/AGENTS.md`, `docs/architektur/AGENTS.md`-Index falls dort gelistet

- [ ] **Step 1:** ADR mit den MUST/MUST NOT aus dem Entwurf („ADR (neu, ergänzt ADR-0101)“) schreiben, Prüfblock:
  `verlange 'aps-environment' 'ios/Helfer/App/LifelineHelfer.entitlements'`,
  `verlange 'remoteMessaging' 'android/helfer/src/main/AndroidManifest.xml'`,
  `verbiete 'firebase|com\.google\.firebase' 'android/helfer/**/*.kts' 'android/helfer/**/*.kt'`,
  `verbiete 'remote-notification' 'ios/project.yml'` nur für das Ziel `LifelineHelfer` (wenn `verbiete` nicht zielgenau geht: weglassen und im ADR begründen).
- [ ] **Step 2:** `./scripts/check-all.sh --nur adr` (oder der ADR-Schritt laut `scripts/AGENTS.md`) — Erwartet: die beiden `verlange` schlagen fehl (noch nicht gebaut). Prüfblock bis Task 11/13 auskommentiert committen, dort scharf schalten (Regel: rot geborenes Gate abschalten).
- [ ] **Step 3:** AGENTS.md-Ergänzungen: Helfer-Ordner je ein Abschnitt „Aufträge (Stufe 2, ADR-0104)“ (Kernlogik, Dienst-Typen, Mitteilungsrecht-Hinweis); `push-relais/AGENTS.md` „Thema je Nachricht“.
- [ ] **Step 4:** Commit `docs(helfer): ADR-0104 Aufträge an die Helfer-App`.

### Task 2: Relais — `thema` und erlaubte Bundle-IDs

**Files:**
- Modify: `push-relais/src/apns.rs` (`Nachricht`, Senden mit `apns-topic`), `push-relais/src/config.rs`, `push-relais/src/api.rs` bzw. `senden.rs` (Prüfung vor Versand), Betriebsdoku des Relais (`docs/betrieb/…push-relais…`)
- Modify: `src/ios_push/relais.rs` (`RelaisNachricht.thema`)
- Test: Relais-Tests mit APNs-Doppel (bestehende Testdatei des Relais)

**Interfaces:**
- Produces: `RelaisNachricht { …, #[serde(skip_serializing_if = "Option::is_none")] thema: Option<String> }` (Server); Relais `Nachricht.thema: Option<String>` mit `#[serde(default)]`; `Config.weitere_bundle_ids: Vec<String>` aus `PUSH_RELAIS_WEITERE_BUNDLE_IDS` (Komma-getrennt, getrimmt, leer erlaubt).

- [ ] **Step 1: Tests schreiben**
  - `thema_wird_als_apns_topic_gesendet`: Config `weitere_bundle_ids=["dev.rubeen.lifeline.helfer"]`, Nachricht mit `thema=Some("dev.rubeen.lifeline.helfer")` → Doppel sieht Header `apns-topic: dev.rubeen.lifeline.helfer`, Ergebnis `zugestellt`.
  - `ohne_thema_gilt_das_hauptbundle`: kein `thema` → `apns-topic` = `bundle_id`.
  - `fremdes_thema_ist_422_ohne_apns`: `thema=Some("x.y")` → HTTP 422, Doppel hat 0 Aufrufe.
  - `config_liest_weitere_bundle_ids`: `"a.b, c.d"` → `["a.b","c.d"]`; leer → `[]`.
- [ ] **Step 2:** `cd push-relais && cargo test` — FAIL (Feld fehlt).
- [ ] **Step 3:** Implementieren; `apns-topic = thema.unwrap_or(bundle_id)`; Prüfung im Handler vor jedem Versand. Server-Struct um das Feld ergänzen (überall `thema: None`).
- [ ] **Step 4:** `cd push-relais && cargo test` und `cargo test ios_push` — PASS.
- [ ] **Step 5:** Betriebsdoku (Variable, „Relais vor dem Server ausrollen“). Commit `feat(push-relais): Thema je Nachricht für die Helfer-App`.

### Task 3: Migration — Push-Anmeldung der Kopplung, Zähler an der Empfängerzeile

**Files:**
- Create: `migrations/NNNN_helfer_pager.sql` (Nummer nach `migrations/AGENTS.md`)
- Create: `src/helfer/push.rs`; Modify: `src/helfer/mod.rs`
- Test: `src/helfer/push.rs` (Unit-Tests mit Testpool, Muster wie `src/geraet/abschnitt.rs`)

**Interfaces:**
- Produces:
  - Tabelle `helfer_push_anmeldung(kopplung_id INTEGER PRIMARY KEY REFERENCES geraet_kopplung(id) ON DELETE CASCADE, kennung TEXT NOT NULL, token TEXT NOT NULL, umgebung TEXT NOT NULL CHECK (umgebung IN ('sandbox','production')), schluessel BLOB NOT NULL, angelegt_at TEXT NOT NULL)`.
  - `auftrag_empfaenger.helfer_gesendet INTEGER` **nullable**: NULL = noch nicht an Helfer ausgeliefert (Bestand), sonst Anzahl. (Abweichung vom Entwurf `NOT NULL DEFAULT 0`: NULL unterscheidet „neu“ von „an 0 gesendet“ für Task 6.) Spiegel-Trigger aus Migration 0314 prüfen und die Spalte dort mitführen, falls die Trigger Spalten aufzählen.
  - `pub struct HelferPushAnmeldung { kopplung_id: i64, kennung: String, token: String, umgebung: crate::ios_push::relais::Umgebung, schluessel: [u8; 32] }`
  - `pub async fn save_registration(pool: &SqlitePool, kopplung_id: i64, a: &HelferPushAnmeldung) -> Result<(), AppError>` (Upsert)
  - `pub async fn delete_registration(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<(), AppError>`
  - `pub async fn load_registrations(pool: &SqlitePool, kopplung_ids: &[i64]) -> Result<Vec<HelferPushAnmeldung>, AppError>`
  - `pub async fn delete_ended(conn: &mut SqliteConnection) -> Result<u64, AppError>` — löscht Anmeldungen, deren Kopplung widerrufen, abgelaufen oder abgelehnt ist oder deren Einsatz nicht aktiv/gelöscht ist.

- [ ] **Step 1:** Tests `speichern_ersetzt_die_anmeldung_der_kopplung`, `delete_ended_raeumt_widerrufene_abgelaufene_und_beendete_einsaetze` (je ein Fall: widerrufen, `laeuft_ab_at` in der Vergangenheit, `helfer_zustand='abgelehnt'`, Einsatz `abgeschlossen` → alle weg, aktive bleibt).
- [ ] **Step 2:** `cargo test helfer::push` — FAIL.
- [ ] **Step 3:** Migration + Funktionen.
- [ ] **Step 4:** `cargo test helfer::push` und `./scripts/check-all.sh --nur migrationen` (Name laut Skriptkopf) — PASS.
- [ ] **Step 5:** Commit `feat(helfer): Push-Anmeldung je Kopplung und Zähler an der Empfängerzeile`.

### Task 4: Eigene Aufträge lesen und quittieren

**Files:**
- Create: `src/helfer/auftraege.rs`; Create: `src/auftrag/quittung.rs` (gemeinsamer Ablauf)
- Modify: `src/routes/auftrag.rs:271-330` (`quittieren` ruft den gemeinsamen Ablauf), `src/routes/helfer.rs`, `src/app.rs` (Routen), `src/geraet/mod.rs` (`HELFER`)
- Test: `tests/helfer_pager.rs` (neu; Helfer `lage`, `anmelden`, `bestaetigen` aus `tests/helfer.rs` nach `tests/common/` ziehen, wenn nötig), `tests/geraet_kopplung.rs` (Routenliste)

**Interfaces:**
- Produces:
  - `pub async fn acknowledge(state: &AppState, einsatz_id: i64, auftrag_id: i64, empfaenger_id: i64, benutzer_id: i64) -> Result<bool, AppError>` in `auftrag::quittung` — Quittung, Benachrichtigung des Erstellers bei erster Quittung, Fristerinnerung schließen, `sse`; liefert „erste Quittung“. Ruft am Ende `helfer::pager::notify_changed` (Task 6; bis dahin Stub, der nichts tut).
  - `pub const PAGER_EMPFAENGER: &str` (SQL-Bedingung, Alias `gk`) in `helfer::auftraege` — Global Constraints, Zeile 1.
  - `pub async fn list_own(pool: &SqlitePool, kopplung_id: i64, now: &str) -> Result<Vec<HelperTask>, AppError>`
  - `pub async fn is_own_row(pool: &SqlitePool, kopplung_id: i64, auftrag_id: i64, empfaenger_id: i64) -> Result<bool, AppError>`
  - Wire (ToSchema, Typ-Codegen): `HelperTask { id, number: Option<i64>, text: String, location: Option<String>, location_lat: Option<f64>, location_lon: Option<f64>, priority: Prioritaet, deadline_at: Option<String>, issued_at: String, cancelled_at: Option<String>, recipients: Vec<HelperTaskRecipient> }`, `HelperTaskRecipient { id, kind: String /* unit|vehicle|person */, label: String /* snap_anzeige */, acknowledged_at: Option<String>, acknowledged_by: Option<String> }`. `acknowledged_by` = Anzeigename der Helfer-Kopplung, sonst Name des Benutzers.
  - Routen: `GET /api/devices/me/tasks` → `HelperTaskList { tasks: Vec<HelperTask> }`; `POST /api/devices/me/tasks/{aid}/recipients/{empf}/acknowledge` → `HelperTask`.
- Liste: nicht aufgehoben, oder aufgehoben vor höchstens 30 min; neueste `erteilt_at` zuerst.

- [ ] **Step 1: Tests (`tests/helfer_pager.rs`)**
  - `bestaetigter_helfer_sieht_auftraege_an_seine_einheit`: Auftrag an Einheit E, an Einheit F, an Abschnitt A → Liste enthält nur den an E.
  - `helfer_mit_fahrzeug_sieht_auftraege_ans_fahrzeug`.
  - `zugeordnete_person_sieht_auftrag_an_sich`: Person P zugeordnet, Auftrag an P → in der Liste mit `kind="person"`.
  - `unbestaetigter_helfer_bekommt_403`: `GET /api/devices/me/tasks` → 403 `{reason:"not_confirmed"}`.
  - `quittung_aus_der_app_schreibt_die_empfaengerzeile`: POST → 200, `auftrag_empfaenger.quittiert_von_id` = Gerätekonto, Ersteller bekommt Benachrichtigung `quittiert`.
  - `fremde_zeile_ist_404`: Zeile an Einheit F → 404.
  - `aufgehobener_auftrag_ist_422`.
  - `zweiter_helfer_sieht_uebernommen_von`: Helfer H1, H2 an E; H1 quittiert; H2 quittiert → 200, `acknowledged_by` = Anzeigename von H1, `quittiert_at` unverändert.
  - Einheitenansicht-Regression: bestehende `tests/auftrag.rs`-Quittungstests unverändert grün.
  - `tests/geraet_kopplung.rs`: `helfer_darf_eigene_auftraege` (beide Routen erlaubt), `helfer_darf_nicht_tasks_des_einsatzes` (`GET /api/incidents/{id}/tasks` verboten).
- [ ] **Step 2:** `cargo test --test helfer_pager --test geraet_kopplung` — FAIL.
- [ ] **Step 3:** Gemeinsamen Ablauf aus `quittieren` herausziehen (Prüfungen `gehoert_pruefen`/`fordere_im_bereich` bleiben im alten Handler), neue Handler über `HelferSitzung`, Routen in `HELFER` und `app.rs`.
- [ ] **Step 4:** `cargo test --test helfer_pager --test geraet_kopplung --test auftrag` — PASS; `scripts/check-typ-codegen.sh`, generierte Dateien mitcommitten.
- [ ] **Step 5:** Commit `feat(helfer): eigene Aufträge lesen und quittieren`.

### Task 5: Push-Anmeldung der App und Ende an allen Wegen

**Files:**
- Modify: `src/routes/helfer.rs` (Handler), `src/app.rs`, `src/geraet/mod.rs` (`HELFER`), `src/geraet/repo.rs` (`beenden`), `src/helfer/ende.rs`, `src/einsatz/repo.rs` (`abschliessen`), Ablauf-Takt `src/geraet/ablauf.rs`
- Test: `tests/helfer_pager.rs`

**Interfaces:**
- Consumes: Task 3 `save_registration`, `delete_registration`, `delete_ended`.
- Produces: `PUT /api/devices/me/push` Body `HelperPushBody { registration_id: String, token: String, environment: String /* sandbox|production */, key: String /* base64url, 32 Byte */ }` → 204; `DELETE /api/devices/me/push` → 204. Erlaubt in `unbestaetigt` und `aktiv`. 400 bei falscher Schlüssellänge/Umgebung.

- [ ] **Step 1: Tests**
  - `push_anmeldung_ersetzt_die_vorige`, `push_anmeldung_mit_kurzem_schluessel_ist_400`.
  - Je Endweg `push_anmeldung_endet_mit_<weg>` für: Widerruf (`…/helpers/{gid}/revoke`), Ablehnung, Abmelden (`/api/auth/logout`), alle entfernen, Einsatz abschließen, Ablauf (Takt-Funktion direkt aufrufen) → Zeile weg.
- [ ] **Step 2:** `cargo test --test helfer_pager push_` — FAIL.
- [ ] **Step 3:** `delete_registration` in `geraet::repo::beenden` (Kopplungs-ID bekannt), `delete_ended` im Ablauf-Takt neben `raeume_abgelaufene` und in `einsatz::repo::abschliessen` neben `beende_ortung_im_einsatz`.
- [ ] **Step 4:** Tests PASS. Commit `feat(helfer): Push-Anmeldung der Helfer-App, endet mit der Kopplung`.

### Task 6: Zustellung (`helfer::pager`)

**Files:**
- Create: `src/helfer/pager.rs`
- Modify: `src/live/mod.rs` (Broadcast), `src/routes/live.rs` (Ereignis in den Gerätestrom einer Helfer-Kopplung), `src/auftrag/mod.rs:299` (`nach_erteilung`), `src/routes/auftrag.rs` (`berichtigen`, `aufheben`), `src/auftrag/quittung.rs` (Task 4 Stub ersetzen), `src/ios_push/mod.rs` (Senden für Pager freigeben)
- Test: `tests/helfer_pager.rs` (Relais-Doppel wie in den `ios_push`-Tests)

**Interfaces:**
- Consumes: Task 3, Task 4 `PAGER_EMPFAENGER`, `IosPush::senden(&[RelaisNachricht])` (`pub(crate)`), `krypto::verschluesseln`/`umschlag`.
- Produces:
  - `pub struct PagerZiel { kopplung_id: i64, empfaenger_ids: Vec<i64>, is_new: bool }` — `is_new` = alle eigenen Zeilen haben `helfer_gesendet IS NULL`.
  - `pub async fn resolve(pool: &SqlitePool, einsatz_id: i64, auftrag_id: i64) -> Result<Vec<PagerZiel>, AppError>`
  - `pub async fn deliver(state: &AppState, einsatz_id: i64, auftrag_id: i64)` — fehlertolerant (loggt, gibt nichts zurück): `resolve`; setzt `helfer_gesendet` an allen Zeilen mit NULL auf die Zahl ihrer Pager-Ziele (auch 0, nur Typen einheit/fahrzeug/person); Live an alle Ziele; iOS-Push an Ziele mit `is_new`.
  - `pub async fn notify_changed(state: &AppState, einsatz_id: i64, auftrag_id: i64)` — nur Live an alle Ziele.
  - `LiveHub::melde_helfer_auftrag(&self, kopplung_ids: Vec<i64>, auftrag_id: i64)`, `LiveHub::abonniere_helfer_auftrag(&self) -> broadcast::Receiver<(Vec<i64>, i64)>`; SSE-Ereignis `event: helfer_auftrag`, `data: {"task_id":<id>}`, nur im Strom einer Kopplung mit `ansicht=Helfer`, deren ID enthalten ist.
  - Pager-Klartext `PagerKlartext { v: 1, s: String /* Instanzname */, art: "auftrag", e: i64, t: i64, titel: String, text: String }` (kurze Feldnamen wie `inhalt::Klartext`), gekürzt wie `inhalt::kuerzen`; `titel` = `snap_anzeige` der ersten eigenen Zeile („an dich“ bei Person), `text` = `auftrag_text`. `RelaisNachricht { stufe: Alarm, kollaps: Some(kollaps(server_id, auftrag_id)) /* Präfix "auftrag:" im Hash-Eingang */, thema: Some("dev.rubeen.lifeline.helfer") }`. `TokenUngueltig` → `delete_registration`.
- Aufrufe: `nach_erteilung` → `deliver` (nach Live `auftrag`); `berichtigen` → `deliver` (neue Zeilen haben NULL; Ziele mit Alt-Zeilen bekommen `is_new=false`, also nur Live); `aufheben` und `quittung::acknowledge` → `notify_changed`. Alle im Hintergrund (`tokio::spawn`), das Erteilen wartet nicht.

- [ ] **Step 1: Tests**
  - `auftrag_an_einheit_geht_an_alle_bestaetigten_helfer`: H1, H2 aktiv an E, H3 unbestätigt an E → Relais-Doppel bekommt 2 Nachrichten (H1, H2 mit Anmeldung), `helfer_gesendet`=2.
  - `pausierter_helfer_bekommt_auftraege`.
  - `helfer_mit_einheit_und_person_bekommt_eine_nachricht`: Auftrag an E und an P (beide H1) → 1 Nachricht, Live-Ereignis 1×.
  - `nach_einsatzende_wird_nichts_zugestellt`: Einsatz abschließen, dann `deliver` direkt aufrufen → 0 Nachrichten, 0 Live.
  - `widerrufener_helfer_bekommt_nichts`.
  - `berichtigung_stellt_nur_neu_betroffenen_zu`: Auftrag an E (H1), Berichtigung fügt F hinzu (H2) → Push nur an H2, Live an H1 und H2, `helfer_gesendet` der E-Zeile bleibt.
  - `nutzlast_ist_entschluesselbar`: Doppel-Nachricht mit `krypto::entschluesseln` und dem Testschlüssel → `art="auftrag"`, `t`=Auftrags-ID; `thema`=Helfer-Bundle, `stufe`=`alarm`.
  - `ungueltiges_token_loescht_die_anmeldung`.
  - `live_ereignis_nur_im_strom_der_betroffenen_kopplung` (Strom H1 sieht `helfer_auftrag`, Strom einer Einheitenansicht und von H3 nicht).
  - `quittung_meldet_den_anderen_helfern_live`.
- [ ] **Step 2:** `cargo test --test helfer_pager` — FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `cargo test --test helfer_pager --test auftrag --test auftrag_berichtigen --test auftrag_aufheben --test helfer` — PASS.
- [ ] **Step 5:** Commit `feat(helfer): Aufträge an die Helfer-App zustellen`.

### Task 7: Leitung sieht Zählung und Helfer-Quittung

**Files:**
- Modify: `src/auftrag/mod.rs` (`AuftragEmpfaengerAnzeige`), `src/auftrag/repo.rs` (Abfrage `empfaenger_von`), generierte Typen, Auftragsdetail und -liste im Frontend (Komponente der Empfängerzeile unter `frontend/src/…auftrag…`)
- Test: `tests/helfer_pager.rs`, Vitest der Empfängerzeile

**Interfaces:**
- Produces: `AuftragEmpfaengerAnzeige.helfer_gesendet: Option<i64>`, `AuftragEmpfaengerAnzeige.quittiert_von_helfer: Option<String>` (Anzeigename der Helfer-Kopplung des quittierenden Gerätekontos).

- [ ] **Step 1:** Rust-Test `auftragsdetail_zeigt_helfer_gesendet_und_quittierenden_helfer`; Vitest: `helfer_gesendet=2` → Text „an 2 Helfer-Apps gesendet“; `1` → „an 1 Helfer-App gesendet“; NULL/0 → kein Text; `quittiert_von_helfer="Max M."` → „quittiert von Max M. (Helfer-App)“.
- [ ] **Step 2:** Tests FAIL.
- [ ] **Step 3:** Implementieren, `scripts/check-typ-codegen.sh`.
- [ ] **Step 4:** `cargo test --test helfer_pager`, `mise exec -- pnpm -C frontend test -- <datei>` — PASS.
- [ ] **Step 5:** Commit `feat(auftrag): Zustellung und Quittung der Helfer-App am Auftrag`.

### Task 8: Gemeinsame Fälle

**Files:**
- Create: `src-tauri/faelle/helfer-auftrag.json`
- Test: Rust-Test in `src/helfer/pager.rs`, der den Testvektor liest

**Interfaces:**
- Produces (Schlüssel der Datei): `zweck`; `nutzlast` (Testvektoren wie `push-nutzlast.json`: `kennung`, `schluessel`, `nonce`, `klartext`, `chiffrat`, `umschlag`); `sse` (Liste `{eingabe: "<Rohtext>", ereignisse: [{name, task_id}]}`, mit Lebenszeichen-Kommentar `:`-Zeilen, mehrzeiligem `data:`, fremdem Ereignis, abgeschnittenem Rahmen); `ordnung` (Liste von Aufträgen → erwartete Reihenfolge: offen vor quittiert vor aufgehoben, dann `issued_at` absteigend); `mitteilung` (`{auftrag, bereits_gemeldet, jetzt} → ja/nein`: nur offen, nicht aufgehoben, nicht gemeldet, `issued_at` höchstens 10 min alt).

- [ ] **Step 1:** Test `pager_nutzlast_passt_zum_testvektor` (verschlüsseln mit fester Nonce ergibt `umschlag`).
- [ ] **Step 2–4:** FAIL → Datei schreiben → PASS.
- [ ] **Step 5:** Commit `test(helfer): gemeinsame Fälle der Aufträge`.

### Task 9: iOS-Kern (`HelferKern`)

**Files:**
- Create: `ios/HelferKern/Sources/HelferKern/Auftraege.swift`, `PagerNutzlast.swift`
- Test: `ios/HelferKern/Tests/HelferKernTests/AuftraegeTests.swift`, `GemeinsameFaelle.swift` erweitern

**Interfaces:**
- Produces: `public struct HelferAuftrag: Codable, Equatable` (Felder wie `HelperTask`), `public enum Auftraege { static func ordnen(_: [HelferAuftrag]) -> [HelferAuftrag]; static func sollMitteilen(_: HelferAuftrag, bereitsGemeldet: Set<Int64>, jetzt: Date) -> Bool }`, `public enum Quittungsstand: Equatable { case offen, sendet, quittiert(um: Date, von: String?), aufgehoben, fehler(String) }` mit `static func aus(_: HelferAuftrag) -> Quittungsstand`, `public enum PagerNutzlast { static func entschluesseln(umschlag: String, schluessel: Data) throws -> PagerKlartext }`.

- [ ] **Step 1:** Tests: Fälle `nutzlast`, `ordnung`, `mitteilung` aus `helfer-auftrag.json`; Quittungsstand aus Feldern (quittiert durch anderen → `.quittiert(von: "Max M.")`).
- [ ] **Step 2:** `swift test --package-path ios/HelferKern` — FAIL.
- [ ] **Step 3:** Implementieren (CryptoKit nur, wenn unter Linux verfügbar; sonst `swift-crypto` wie `LifelineKern` es tut — nachsehen, wie `PushNutzlast.swift` entschlüsselt, und genau so).
- [ ] **Step 4:** PASS. Commit `feat(ios-helfer): Kern für Aufträge`.

### Task 10: iOS-App — Push, Mitteilungsdienst, Bereich „Aufträge“

**Files:**
- Modify: `ios/project.yml` (Ziel `HelferDienst`, Entitlements), `ios/Helfer/App/LifelineHelfer.entitlements` (`aps-environment`), `ios/Helfer/App/Modell/HelferModell.swift`, `ios/Helfer/App/Dienste/Serververbindung.swift` (Routen Task 4/5), `ios/Helfer/App/Seiten/` (Angemeldet: Bereich; neu: `AuftragSeite.swift`), `.github/workflows/ios-helfer.yml` (Kennung `…helfer.dienst`), `scripts/ios/testflight.sh` falls Bundle-Liste dort
- Create: `ios/Helfer/Dienst/Dienst.swift`, `ios/Helfer/Dienst/HelferDienst.entitlements`, `Info.plist`/`PrivacyInfo.xcprivacy` nach Muster `ios/Benachrichtigungsdienst`
- Apple-Portal (Main-Loop, Browser): Kennung `dev.rubeen.lifeline.helfer.dienst` mit App Group; Push am Hauptbundle prüfen.

- [ ] **Step 1:** Testzustände für „Angemeldet mit Aufträgen“, „Angemeldet ohne Aufträge“, „Mitteilungen aus“, „Auftrag offen“, „Auftrag übernommen von anderem“, „Auftrag aufgehoben“, „Quittung fehlgeschlagen“ anlegen; Bildtest-Ziel wie in Stufe 1.
- [ ] **Step 2:** Schlüssel und Kennung erzeugen und ablegen wie die Hülle (`LifelineKern/PushAnmeldungen.swift` + `ios/Benachrichtigungsdienst/Dienst.swift` als Muster), Anmeldung `PUT /api/devices/me/push` nach dem Einlösen und nach jedem neuen Token; `DELETE` beim Abmelden.
- [ ] **Step 3:** Mitteilungsdienst: `PagerNutzlast.entschluesseln`, `interruptionLevel = .timeSensitive`, `sound = .default`, `userInfo["task_id"]`; Fehler → Inhalt unverändert.
- [ ] **Step 4:** Bereich und Detail; Tippen auf Mitteilung öffnet Detail; `willPresent` → Liste neu laden; Vordergrund → neu laden. „Übernommen“ ruft die Quittungsroute; Fehler „Bitte über Funk bestätigen“.
- [ ] **Step 5:** Prüfblock aus Task 1 für iOS scharf schalten; `swift test --package-path ios/HelferKern`; Kompilieren nur in der CI (`ios-pruefung.yml`), lokal nicht möglich — im PR vermerken.
- [ ] **Step 6:** Commit `feat(ios-helfer): Aufträge empfangen und übernehmen`.

### Task 11: Android-Kern (`helferkern`)

**Files:**
- Create: `android/helferkern/src/main/kotlin/dev/rubeen/lifeline/helferkern/Livestrom.kt`, `Empfang.kt`, `Auftraege.kt`; Modify: `Wire.kt` (`HelperTask`), `Testzustand.kt`
- Test: `android/helferkern/src/test/…/AuftraegeTest.kt`, `LivestromTest.kt`, `EmpfangTest.kt`, `GemeinsameFaelleTest.kt`

**Interfaces:**
- Produces:
  - `class SseLeser { fun zeile(z: String): LiveEreignis? }` mit `sealed interface LiveEreignis { data class Auftrag(val taskId: Long); data object Lebenszeichen; data object Unbekannt }`
  - `object Empfang { fun nachAbbruch(versuch: Int): Long /* Wartezeit ms: 1s,2s,4s… max 60s */; fun nachAntwort(status: Int): Entscheidung }` mit `enum Entscheidung { VERBINDEN, WARTEN, ENDEN }` (401/403/404 → ENDEN; 5xx/429/Netz → WARTEN)
  - `object Auftraege { fun ordnen(l: List<HelperTask>): List<HelperTask>; fun sollMitteilen(a: HelperTask, bereitsGemeldet: Set<Long>, jetztMs: Long): Boolean; fun stand(a: HelperTask): Quittungsstand }`

- [ ] **Step 1:** Tests: gemeinsame Fälle `sse`, `ordnung`, `mitteilung`; `Empfang`-Tabelle; Quittungsstand wie iOS.
- [ ] **Step 2:** `cd android && ./gradlew :helferkern:test` (bzw. wie `android-pruefung.yml` es ruft) — FAIL.
- [ ] **Step 3–4:** Implementieren — PASS.
- [ ] **Step 5:** Commit `feat(android-helfer): Kern für Aufträge und Live-Empfang`.

### Task 12: Android-App — Dienst, Mitteilungen, Bereich „Aufträge“

**Files:**
- Modify: `android/helfer/src/main/AndroidManifest.xml` (Typen `location|remoteMessaging`, `FOREGROUND_SERVICE_REMOTE_MESSAGING`), `…/dienste/OrtungsDienst.kt` (wird Helfer-Dienst; Umbenennen als eigener `refactor`-Commit, falls umbenannt), `…/dienste/Serververbindung.kt` (Routen Task 4, SSE-Verbindung), `…/HelferModell.kt` (Dienst immer beim Einlösen starten, auch ohne Ortung), `…/seiten/` (Angemeldet-Bereich, neu `AuftragSeite.kt`)
- Test: Robolectric/Compose-Tests und Bilder wie Stufe 1 (`android-helfer-bilder`)

- [ ] **Step 1:** Tests: `dienst_startet_beim_einloesen_ohne_ortung_nur_mit_empfang` (Typ-Maske = remoteMessaging), `benachrichtigung_zeigt_empfang_und_ortung` (Texte aus Global Constraints), `neuer_auftrag_erzeugt_mitteilung_im_kanal_auftraege` (Wichtigkeit hoch, `VISIBILITY_PRIVATE`, öffentliche Fassung „Neuer Auftrag“), `ohne_mitteilungsrecht_zeigt_hinweis`; Testzustände wie iOS Task 10 Step 1.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** SSE auf IO-Dispatcher im Dienst-Scope ab `aktiv`, auf `LiveEreignis.Auftrag` Liste laden und `Auftraege.sollMitteilen`; nach Neuverbinden Liste laden. Typwechsel per erneutem `startForeground` mit passender Maske; `location` nur aufnehmen, wo Android es erlaubt, sonst Text „Ortung wartet — App öffnen“.
- [ ] **Step 4:** PASS; Prüfblock aus Task 1 für Android scharf schalten.
- [ ] **Step 5:** Commit `feat(android-helfer): Aufträge empfangen und übernehmen`.

### Task 13: Doku

**Files:**
- Modify: Anwenderkapitel „Helfer anmelden“ (Abschnitt „Aufträge empfangen“) und Leitungskapitel Aufträge („Aufträge an Helfer“) nach `docs/anwender/AGENTS.md`; DSFA-Vorlage aus Stufe 1 (Absatz Aufträge auf Privatgeräten, Sperrbildschirm); arc42 nach `docs/architektur/AGENTS.md` (Bausteinsicht Helfer, Laufzeitsicht Zustellung, ADR-0104).

- [ ] **Step 1:** Schreiben; Wächter laut `docs/anwender/AGENTS.md` laufen lassen.
- [ ] **Step 2:** Commit `docs(helfer): Aufträge an die Helfer-App`.

### Task 14: Abschluss

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` — grün.
- [ ] **Step 2:** Skill `verify` für das Auftragsdetail der Leitung (Bild „an n Helfer-Apps gesendet“).
- [ ] **Step 3:** Review nach Ermessen (Anlass: gekoppelte Geräte, Live-Verteilung, Größe) — ein Agent mit `references/review-pruefliste.md`.
- [ ] **Step 4:** PR gegen `alpha` mit Labels `testflight-helfer`, `apk-helfer`.
