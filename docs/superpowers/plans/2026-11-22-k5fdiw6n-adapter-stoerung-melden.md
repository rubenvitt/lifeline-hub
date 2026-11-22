# Adapter-Störung an die Admins melden — Umsetzungsplan (LLH-2026)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hält ein Adapter an oder ist er 30 Minuten gestört, bekommen die System-Admins seiner Org genau eine Benachrichtigung (Eingang, Toast, Web Push); kommt er von selbst zurück, folgt eine Entwarnung.

**Architecture:** Die Benachrichtigung bekommt einen zweiten Ort neben dem Einsatz: den Adapter (`benachrichtigung.adapter_id`, `einsatz_id` darf leer sein). Der Adapter-Lauf entscheidet über einen Merker `adapter.gemeldet` in seiner Transaktion, ob gemeldet wird, und ruft nach dem Commit `benachrichtigung::melden` mit `Anlass::adapter(…)`. Alles Adapter-Spezifische der Benachrichtigung (Empfänger, Leserecht, Text, Erledigen) liegt in einem neuen Modul `src/benachrichtigung/adapter.rs`.

**Tech Stack:** Rust (axum, sqlx/SQLite), React/TypeScript (Vitest), Service Worker.

**Spec:** `docs/superpowers/specs/2026-11-22-k5fdiw6n-adapter-stoerung-melden-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/k5fdiw6n15wrlvkgqdn0dlpw

## Global Constraints

- Schwelle „gestört“: **30 Minuten** seit `fehler_seit` (`MELDESCHWELLE_GESTOERT_S = 1800`).
- Stufe aller drei Arten: **Eingang** (`hinweis`); alle drei sind Org-Arten.
- Titel: „Anbindung braucht Eingriff“, „Anbindung gestört“, „Anbindung läuft wieder“.
- Empfänger: aktive Konten mit System-Rolle `admin` und `org_id` des Adapters, ohne Gerätekonten.
- `geheimnisspeicher_gesperrt` löst nie eine Meldung aus.
- Nie Geheimnis, URL oder Text des Ziels in Zeile, Nutzlast, Push, Detail oder Log.
- Sprung: `/admin/einstellungen/anbindungen/adapter/{id}` (ID URL-kodiert wie `adapterPath`).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`, LFH-1312); Prosa deutsch.
- Neue Wire-Enums über `wire_enum!` mit Eintrag im Enum-Kontrakt (ADR-0006).
- Migration: Nummer größer als jede auf `origin/alpha` (`scripts/check-migrationen.sh`).
- Nach DTO-/Enum-Änderung `scripts/check-typ-codegen.sh`, beide generierten Dateien committen.
- Bestehende Aufrufer von `Anlass::neu`, `melden`, `erledigen` ändern sich nicht.

## Review Focus

1. Admin hält an, während ein Abruf läuft: der veraltete Abruf setzt keinen Merker und meldet nichts (Task 4, Test `veralteter_abruf_meldet_nicht`).
2. Ein Admin verliert die Admin-Rolle oder wechselt die Org nach dem Melden: `GET /api/benachrichtigungen/{id}` ist 404, die Liste lässt die Zeile aus (Task 2, Test `adapter_zeile_nur_fuer_admin_der_org_lesbar`).
3. Ein Adapter-Name mit einer URL darin: das Detail zeigt den Namen, wie der Admin ihn vergab, aber nie `einstellungen` (Task 4, Test `meldung_enthaelt_keine_einstellung_und_kein_geheimnis`).
4. Ein Einsatz-Client bekommt eine Org-Benachrichtigung ohne Einsatz: kein `/einsaetze/null`, Tag ohne `undefined` (Task 6, Tests in `benachrichtigungKatalog.test.ts` und `alarmSw.test.ts`).
5. Der Adapter wird gelöscht, während eine Meldung offen ist: Quittier-Ereignis geht vor dem Löschen raus, danach keine Zeile mehr (Task 5, Test `loeschen_erledigt_und_raeumt`).

---

### Task 1: Katalog und Schema

**Files:**
- Create: `migrations/0363_benachrichtigung_adapter.sql` (Nummer ggf. per `scripts/check-migrationen.sh --umnummerieren`)
- Modify: `src/benachrichtigung/mod.rs` (Arten, Bezug, `stufe`, `ist_org`, `modul`), `src/benachrichtigung/text.rs` (`titel`), `src/adapter/zustand.rs` (`AdapterGemeldet`), `src/instanz/spiegel/hinweis.rs` (`bezug_tabelle`), `src/einsatz/schwaerzung_registry.rs` (`benachrichtigung.adapter_id`)
- Test: `src/benachrichtigung/tests.rs`, `tests/enum_wire_kontrakt.rs`

**Interfaces:**
- Produces: `BenachrichtigungArt::{AdapterEingriff => "adapter_eingriff", AdapterGestoert => "adapter_gestoert", AdapterWiederOk => "adapter_wieder_ok"}`; `BenachrichtigungBezugTyp::Adapter => "adapter"` (`modul() == None`); `adapter::zustand::AdapterGemeldet { Gestoert => "gestoert", Eingriff => "eingriff" }` (`wire_enum!`); Spalten `benachrichtigung.adapter_id TEXT`, `adapter.gemeldet TEXT`.

- [x] **Step 1: Tests anpassen.** In `src/benachrichtigung/tests.rs`: `org_arten_sind_…` erwartet zusätzlich die drei Adapter-Arten als Org-Arten der Stufe `Hinweis`; neuer Test `adapter_arten_sind_eingang_und_nicht_am_einsatz_einstellbar` (`stufe() == Hinweis`, `ist_org()`, `!vorgabe_einstellbar()`); neuer Test `benachrichtigung_hat_genau_einen_ort` (INSERT mit beiden Orten und mit keinem scheitert am CHECK, mit genau einem gelingt). Im Enum-Kontrakt die neuen Wire-Werte und `AdapterGemeldet`.
- [x] **Step 2: Rot sehen:** `cargo test --lib benachrichtigung::tests` → Kompilier- bzw. Assertionsfehler.
- [x] **Step 3: Migration.** Neubau von `benachrichtigung` nach Muster 0352 (Blatt-Umbau, ohne Marker): `einsatz_id` ohne `NOT NULL`, neu `adapter_id TEXT REFERENCES adapter(id) ON DELETE CASCADE`, `CHECK ((einsatz_id IS NULL) <> (adapter_id IS NULL))`, Art-CHECK um die drei Arten ergänzt, Indizes wie 0352 plus `idx_benachrichtigung_adapter ON benachrichtigung(adapter_id)`. Dazu `ALTER TABLE adapter ADD COLUMN gemeldet TEXT CHECK (gemeldet IN ('gestoert', 'eingriff'))`. Kopfkommentar mit LLH-2026 und Begründung. Doc-Kommentar von `BenachrichtigungArt` auf die neue Migration zeigen lassen.
- [x] **Step 4: Enums und Matches** in den oben genannten Dateien ergänzen; `bezug_tabelle` für `Adapter` → `None` (bleibt lokal, reist nie); Registry: `adapter_id` als Kennung `Retain` wie `einheit_id`.
- [x] **Step 5: Grün:** `cargo test --lib benachrichtigung::tests && cargo test --test enum_wire_kontrakt && cargo test --lib db::tests && cargo test --lib einsatz::schwaerzung` → PASS.
- [x] **Step 6: Commit** `feat: Benachrichtigungsarten und Schema für Adapter-Störungen (LLH-2026)`.

### Task 2: Ort „Adapter“ in der Benachrichtigung

**Files:**
- Create: `src/benachrichtigung/adapter.rs`
- Modify: `src/benachrichtigung/mod.rs`, `repo.rs`, `aufloesung.rs`, `src/routes/benachrichtigung.rs`, `src/instanz/spiegel/hinweis.rs` (Zugriff `anlass.einsatz_id`, Adressat-Textform)
- Test: `src/benachrichtigung/tests.rs`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `pub enum Ort { Einsatz(i64), Adapter { org_id: i64, adapter_id: String } }` in `benachrichtigung`; `Anlass { ort: Ort, … }` statt `einsatz_id`; `Anlass::neu(einsatz_id, art, bezug)` unverändert; `Anlass::adapter(org_id: i64, adapter_id: &str, art, bezug) -> Anlass` (setzt `Adressat::OrgAdmins`); `Anlass::einsatz_id(&self) -> Option<i64>`.
  - `Adressat::OrgAdmins`.
  - `BenachrichtigungEreignis.einsatz_id: Option<i64>`, `BenachrichtigungAnzeige.einsatz_id: Option<i64>` (immer serialisiert).
  - `repo::Zeile { einsatz_id: Option<i64>, adapter_id: Option<String>, … }`.
  - `zustellen(live, org_id, einsatz_id: Option<i64>, art, ereignisse)`.
  - `benachrichtigung::erledigen_adapter(pool, live, org_id: i64, adapter_id: &str) -> usize`: quittiert alle offenen Zeilen der drei Adapter-Arten mit dieser `adapter_id` und stellt jedem Empfänger sein Quittier-Ereignis über den Org-Kanal zu.
  - In `adapter.rs`: `empfaenger(pool, org_id) -> Result<Aufgeloest, AppError>` (still: wer die Art abgeschaltet hat), `darf_lesen(pool, benutzer, adapter_id) -> Result<bool, AppError>`, `text(pool, art, adapter_id) -> Result<Option<text::Text>, AppError>`, `DETAIL_ADAPTER_SPALTEN: &[(&str, &str)]`, `fehler_text(AdapterFehler, Option<i64>) -> String`.

- [x] **Step 1: Tests schreiben** in `src/benachrichtigung/tests.rs` (Pool mit Org, Adapter-Zeile per SQL, zweitem Admin, Führungskraft, Admin fremder Org, Gerätekonto):
  - `adapter_anlass_erreicht_nur_admins_der_org`: `melden(Anlass::adapter(org, id, AdapterEingriff, Bezug::neu(Adapter, 1)))` liefert genau die beiden aktiven Admins der Org; Führungskraft, fremder Admin, inaktiver Admin und Gerätekonto fehlen; Zeilen haben `einsatz_id IS NULL`, `adapter_id = id`.
  - `adapter_art_abgeschaltet_ist_still`: Admin mit `benachrichtigungen_aus = ["adapter_gestoert"]` bekommt eine stille Zeile.
  - `adapter_zeile_nur_fuer_admin_der_org_lesbar`: nach Herabstufen des Admins (`system_rolle = 'keiner'`) ist die Zeile über `adapter::darf_lesen` nicht lesbar; nach Löschen des Adapters gibt es keine Zeile mehr.
  - `adapter_text_nennt_name_und_fehler`: `text(AdapterEingriff)` → Titel „Anbindung braucht Eingriff“, Detail „Quelle · Zugang abgelehnt (401)“-artig aus `angehalten_grund`/`letzter_fehler_status`; `AdapterGestoert` mit `letzter_fehler_art = 'status'`, Status 503 → Detail enthält „503“; `AdapterWiederOk` → Detail = Name; Pfad `/admin/einstellungen/anbindungen/adapter/<id>`.
  - `erledigen_adapter_quittiert_offene`: zwei offene Zeilen → `erledigen_adapter` liefert 2, beide `quittiert_at IS NOT NULL`.
  - `detail_adapter_liest_nur_adapterspalten`: jede Spalte in `DETAIL_ADAPTER_SPALTEN` gehört zu Tabelle `adapter` und ist per `SELECT … LIMIT 0` lesbar; keine heißt `einstellungen`.
  - Bestehende Tests bleiben unverändert grün (Einsatz-Weg).
- [x] **Step 2: Rot sehen:** `cargo test --lib benachrichtigung` → FAIL.
- [x] **Step 3: Umsetzen.**
  - `melden_mit_fehler`: bei `Ort::Adapter` kein `hub_ziele`/Vormerken, keine `konten_am_hub`; Auflösung über `adapter::empfaenger`; sonst unverändert. `aufloesung::empfaenger` bleibt für den Einsatz-Ort und gibt bei `Ort::Adapter` an `adapter::empfaenger` ab.
  - `repo::anlegen` schreibt `einsatz_id`/`adapter_id` aus dem Ort; `aus_roh` liest beide.
  - Routen `liste`/`lesen`: Zeilen mit `adapter_id` über `adapter::darf_lesen` und `adapter::text`, sonst wie bisher (`Leserecht`). `quittieren`: Org aus `adapter.org_id` bei Adapter-Zeilen.
  - Hub (`instanz/spiegel/hinweis.rs`): `vormerken` nimmt die Einsatzkennung aus `anlass.einsatz_id()` (dort immer gesetzt, sonst `Ok(())`); `Adressat::OrgAdmins` hat keine Textform und wird beim Vormerken übersprungen; `adressaten_gehen_als_text` nimmt ihn ausdrücklich aus.
  - `fehler_text`: kurze deutsche Bezeichnung je `AdapterFehler` (Wortlaut aus `frontend/src/pages/einstellungen/adapterAnzeige.ts`, falls dort vorhanden), bei `Status` „Antwort {status}“.
- [x] **Step 4: Grün:** `cargo test --lib benachrichtigung && cargo test --lib instanz::spiegel::hinweis && cargo test --test benachrichtigung && cargo test --test instanz_hinweise` → PASS.
- [x] **Step 5: Commit** `feat: Benachrichtigung am Ort Adapter (LLH-2026)`.

### Task 3: Entscheidung, wann gemeldet wird

**Files:**
- Modify: `src/adapter/zustand.rs`
- Test: `src/adapter/zustand.rs` (`mod tests`)

**Interfaces:**
- Consumes: `AdapterGemeldet` (Task 1).
- Produces: `pub const MELDESCHWELLE_GESTOERT_S: i64 = 30 * 60;` und `pub fn meldung_nach_fehlschlag(fehler: AdapterFehler, nach: &NachFehlschlag, gemeldet: Option<AdapterGemeldet>, jetzt: &str) -> Option<AdapterGemeldet>` — die Stufe, die jetzt zu melden ist.

- [x] **Step 1: Tests:**
  - `anhalten_meldet_eingriff_einmal`: `Anhalten` + `None` → `Some(Eingriff)`; + `Some(Gestoert)` → `Some(Eingriff)`; + `Some(Eingriff)` → `None`.
  - `gestoert_erst_ab_dreissig_minuten`: `Wiederholen{fehler_seit: "…10:00:00"}` mit `jetzt` 10:29:59 → `None`; 10:30:00 → `Some(Gestoert)`; mit `gemeldet = Some(Gestoert)` oder `Some(Eingriff)` → `None`.
  - `gesperrter_speicher_meldet_nie`: `GeheimnisspeicherGesperrt` + `Anhalten` + `None` → `None`.
- [x] **Step 2: Rot:** `cargo test --lib adapter::zustand` → FAIL.
- [x] **Step 3: Implementieren** (Regeln aus dem Spec, Abschnitt „Wann gemeldet wird“).
- [x] **Step 4: Grün:** derselbe Befehl → PASS.
- [x] **Step 5: Commit** `feat: Entscheidung über die Störungsmeldung eines Adapters (LLH-2026)`.

### Task 4: Lauf meldet

**Files:**
- Modify: `src/adapter/lauf.rs`, `src/adapter/repo.rs`, `src/main.rs`
- Test: `tests/adapter_lauf.rs`

**Interfaces:**
- Consumes: Task 2 (`Anlass::adapter`, `melden`, `erledigen_adapter`), Task 3.
- Produces:
  - `lauf::start(pool, rahmen, live: LiveHub, stopp)`, `lauf::durchgang(pool, rahmen, live: &LiveHub, jetzt)`.
  - `repo::Adapter::gemeldet(&self) -> Option<AdapterGemeldet>` (Spalte `gemeldet`).
  - `repo::save_versuch(…) -> Result<i64, sqlx::Error>` (Kennung des Versuchs).
  - `repo::mark_gemeldet(conn, id: &str, stufe: AdapterGemeldet) -> Result<bool, sqlx::Error>`: bedingtes UPDATE (`Eingriff`: wo `gemeldet IS NOT 'eingriff'`; `Gestoert`: wo `gemeldet IS NULL`), `true` bei einer geänderten Zeile.
  - `repo::clear_gemeldet(conn, id: &str) -> Result<bool, sqlx::Error>`: `gemeldet = NULL` wo gesetzt, `true` wenn es gesetzt war.

- [x] **Step 1: Tests** in `tests/adapter_lauf.rs`. `Umgebung` hält den `LiveHub` aus `setup_mit_state` und legt einen zweiten System-Admin (`benutzer_anlegen` + `UPDATE benutzer SET system_rolle = 'admin'`) und eine Führungskraft an; Hilfsfunktion `meldungen(&self, cookie) -> Vec<Value>` über `GET /api/benachrichtigungen`.
  - `anhalten_meldet_genau_einmal_an_die_admins`: `Abgelehnt` 401 → beide Admins je genau eine `adapter_eingriff` mit `einsatz_id == null`, Pfad zur Adapteransicht; Führungskraft und Admin von `fremde_org_anlegen` keine; weitere Durchgänge (auch 3 h später) keine zweite.
  - `kurze_stoerung_meldet_nicht`: `Verbindung` bei t0, t0+61 s, t0+200 s, t0+500 s, t0+1000 s (jeweils vor 30 min) → keine Meldung.
  - `lange_stoerung_meldet_einmal_ab_dreissig_minuten`: Fehler bei t0 und dann je fälligem Durchgang bis t0+31 min → genau eine `adapter_gestoert`; weiterer Fehler bei t0+50 min → keine zweite.
  - `eskalation_ersetzt_die_stoerungsmeldung`: gestört gemeldet, dann `Abgelehnt` → eine `adapter_eingriff`, die `adapter_gestoert` ist quittiert.
  - `erholung_erledigt_und_entwarnt`: gestört gemeldet, dann Erfolg → Störung quittiert, eine `adapter_wieder_ok`; Merker leer.
  - `erfolg_ohne_meldung_entwarnt_nicht`: kurzer Fehler, dann Erfolg → keine Benachrichtigung.
  - `gesperrter_speicher_meldet_nicht`: Rahmen ohne Schlüssel (`adapter_testart::rahmen_mit(&art, None)`) und Adapter mit Pflichtgeheimnis → angehalten mit `geheimnisspeicher_gesperrt`, keine Meldung; Neustart mit Schlüssel (`lauf::beim_start`) und Erfolg → keine Entwarnung.
  - `veralteter_abruf_meldet_nicht`: Abruf mit älterem `stand` (Admin ändert den Namen zwischen Laden und Schreiben, Muster der bestehenden Tests zum Stand) → kein Merker, keine Meldung.
  - `meldung_enthaelt_keine_einstellung_und_kein_geheimnis`: Adapter mit Einstellung, die eine URL mit Zugangsdaten trägt (falls die Test-Art kein URL-Feld hat: Token-Wert prüfen), Meldung anhalten lassen → serialisierte Liste enthält weder `TOKEN` noch die Einstellungswerte.
- [x] **Step 2: Rot:** `cargo test --test adapter_lauf` → FAIL (Kompilierfehler `durchgang`).
- [x] **Step 3: Umsetzen.** `record_failure`: in der Transaktion nach `save_fehlschlag` (nur wenn `is_unveraendert`) `meldung_nach_fehlschlag(f.art, &nach, a.gemeldet(), jetzt)`; bei `Some(stufe)` `mark_gemeldet`; die Kennung aus `save_versuch` ist `bezug_id`. Nach dem Commit: bei `Eingriff` zuerst `erledigen_adapter`, dann `melden(Anlass::adapter(a.org_id, &a.id, art, Bezug::neu(Adapter, versuch_id)))`. Erfolgszweig von `run_one`: in der Transaktion `clear_gemeldet` nach `save_erfolg`; war gesetzt → nach dem Commit `erledigen_adapter` und `melden(… AdapterWiederOk …)`. Bestehende Tests rufen `durchgang` mit dem `LiveHub` der Umgebung.
- [x] **Step 4: Grün:** `cargo test --test adapter_lauf && cargo test --test adapter && cargo test --lib adapter` → PASS (Name der Routen-Testdatei per `ls tests/adapter*.rs` prüfen).
- [x] **Step 5: Commit** `feat: Adapter-Lauf meldet Störungen an die Admins (LLH-2026)`.

### Task 5: Admin greift ein

**Files:**
- Modify: `src/routes/adapter.rs`
- Test: `tests/adapter_lauf.rs`

**Interfaces:**
- Consumes: `repo::clear_gemeldet`, `benachrichtigung::erledigen_adapter`.

- [x] **Step 1: Tests:**
  - `fortsetzen_erledigt_ohne_entwarnung`: angehalten und gemeldet, Admin `POST …/fortsetzen` (Route per `grep` in `src/app.rs` prüfen) → Meldung quittiert, Merker leer, keine `adapter_wieder_ok`, auch nicht nach dem nächsten Erfolg.
  - `neues_geheimnis_erledigt`: angehalten gemeldet, `PUT …/geheimnisse/token` → quittiert, Merker leer.
  - `anhalten_durch_admin_erledigt_stoerung`: gestört gemeldet, Admin hält an → quittiert.
  - `loeschen_erledigt_und_raeumt`: gemeldet, `DELETE` → keine Zeile mit dieser `adapter_id` mehr.
  - `umbenennen_laesst_merker_stehen`: gestört gemeldet, nicht wirksame Änderung → Meldung offen, Merker steht.
- [x] **Step 2: Rot:** `cargo test --test adapter_lauf` → FAIL.
- [x] **Step 3: Umsetzen.** `resume`, `halt`: `clear_gemeldet` in der Transaktion der Route. `update` (nur wenn wirksam und `vorher.angehalten_grund` gesetzt) und `set_geheimnis` (wenn der Adapter vorher einen `angehalten_grund` hatte): ebenso. Nach dem Commit bei `true`: `erledigen_adapter`. `delete`: vor der Transaktion `erledigen_adapter`.
- [x] **Step 4: Grün:** `cargo test --test adapter_lauf` → PASS.
- [x] **Step 5: Commit** `feat: Eingriff eines Admins erledigt die Störungsmeldung (LLH-2026)`.

### Task 6: Wire und Frontend

**Files:**
- Modify: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts` (Codegen), `frontend/src/alarm/benachrichtigungKatalog.ts`, `useBenachrichtigungen.ts`, `hinweisInhalt.ts`, `meldungInhalt.ts`, `erinnerungInhalt.ts`, `useEingangshinweis.tsx`, `frontend/public/alarm-sw.js`, `frontend/src/pages/BenachrichtigungenPage.tsx` bzw. `alarm/useBenachrichtigungsEinstellungen.ts`
- Test: `frontend/src/alarm/benachrichtigungKatalog.test.ts`, `frontend/src/alarm/alarmSw.test.ts`, Test der Einstellungsseite

**Interfaces:**
- Consumes: Wire aus Task 2 (`einsatz_id: number | null`, Arten, Bezug `adapter`).
- Produces: `AlarmZiel` `'anbindungen'`; Katalogeinträge der drei Arten (`org: true`, `stufe: 'hinweis'`, Namen wie Global Constraints).

- [x] **Step 1: Codegen:** `scripts/check-typ-codegen.sh` (Schreibmodus laut Skriptkopf) → beide Dateien aktualisiert.
- [x] **Step 2: Tests:** Katalog-Test: Org-Arten sind Aufnahme, neuer Einsatz und die drei Adapter-Arten; `zielVon` der Adapter-Arten ist `'anbindungen'`; `ersatzPfad` eines Ereignisses mit `einsatz_id: null` ist `/admin/einstellungen/anbindungen` und enthält nie `null`. SW-Test: Ereignis mit `einsatz_id: null` → Rückfallziel ohne `/einsaetze/null`, Tag `null-b-<id>` wie `eintragVon`. Einstellungsseite: die drei Schalter nur für Admins.
- [x] **Step 3: Rot:** in `frontend/`: `mise exec -- pnpm exec vitest run src/alarm` → FAIL; `mise exec -- pnpm exec tsc --noEmit` zeigt die Stellen mit `number | null`.
- [x] **Step 4: Umsetzen** nach Spec, Abschnitt „Frontend“; Pfade über `adapterPath`/`anbindungenPath`.
- [x] **Step 5: Grün:** `mise exec -- pnpm exec tsc --noEmit && mise exec -- pnpm exec vitest run src/alarm src/pages` und `mise exec -- pnpm exec prettier --check .` → PASS.
- [x] **Step 6: Commit** `feat: Adapter-Störungen im Frontend (LLH-2026)`.

### Task 7: Regeln und Doku

**Files:**
- Modify: `src/AGENTS.md` („Benachrichtigungen“: zweiter Ort, `OrgAdmins`, Leserecht ohne Einsatz, reist nicht zum Hub, Detailspalten des Adapters neben der Schwärzung, `erledigen_adapter`; „Adapter“: Meldung über den Merker, Schwelle, gesperrter Speicher), `docs/anwender/kapitel/anbindungen.md`, ggf. arc42 laut `docs/architektur/AGENTS.md`

- [x] **Step 1:** Regeln und Anwenderabschnitt schreiben (Kapitelform und Wächter: `docs/anwender/AGENTS.md`).
- [x] **Step 2:** `./scripts/check-all.sh --nur schnell` → grün.
- [x] **Step 3: Commit** `docs: Regeln und Anwenderdoku zur Störungsmeldung (LLH-2026)`.

### Task 8: Gesamtprüfung

- [x] **Step 1:** `git fetch origin alpha && scripts/check-migrationen.sh` → keine Konflikte.
- [x] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (Ergebnis für „Geprüft“ im PR festhalten).
- [x] **Step 3:** Review nach Ermessen (Anlass: mehrere Schreibvorgänge, Backend und Frontend mit geänderter Schnittstelle).

## Abschluss (22.11.2026)

Alle Aufgaben umgesetzt. „`check-all.sh --geaendert --ohne-e2e` grün“ (Task 8) ist belegt durch:
`--nur schnell` grün, `--nur frontend` grün (1421 Dateien, 22 787 Tests), `cargo check -p
lifeline-hub --tests`, `cargo test --lib` (4633) und die 38 Integrationsdateien zu
Benachrichtigung und Adapter grün. Die volle Rust-Suite lief lokal nicht (Plattenkontingent der
Cloud-Sitzung); sie läuft auf `alpha`. Review: ein Agent, 6 Befunde, 4 behoben, 2 begründet
offen (PR-Beschreibung).
