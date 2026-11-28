# Fristen der Org in der Admin-Spur — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder echte Wechsel von Aufbewahrungs-Dauer, Skelett-Frist oder Nachbereitung der Org steht mit Person, Zeitpunkt, altem und neuem Wert in `admin_audit` und im Zugangsprotokoll.

**Architecture:** `org::einstellungen::speichern` liest die drei Fristen in der Speicher-Transaktion vor dem Schreiben (`Gespeichert::fristen_vorher`); der Handler vergleicht mit dem Endstand und schreibt je Wechsel eine Zeile mit `ZugangsAngaben { tage_vorher, tage }`. Migration 0392 erweitert den aktion-CHECK; das Frontend beschriftet die Aktionen und zeigt den Wechsel.

**Tech Stack:** Rust (axum, sqlx/SQLite), TypeScript/React (vitest).

**Spec:** `docs/superpowers/specs/2026-11-28-ya26uq7e-fristen-admin-spur-design.md`

## Global Constraints

- Wire-Werte: `aufbewahrung_frist_geaendert`, `skelett_frist_geaendert`, `nachbereitung_frist_geaendert`; Ziele `aufbewahrung_frist`, `skelett_frist`, `nachbereitung_frist`.
- Texte: „Aufbewahrungs-Dauer geändert“, „Skelett-Frist geändert“, „Nachbereitung geändert“; Detail „3650 → 365 Tage“, „keine → 365 Tage“, „365 Tage → keine“, „1 Tag“.
- Migrationen nur anhängen (`migrations/AGENTS.md`); Blatt-Umbau ohne `-- no-transaction`.
- Nach DTO-/Enum-Änderung `scripts/check-typ-codegen.sh`, beide generierten Dateien committen.
- Prosa deutsch, neue Bezeichner nach `AGENTS.md`, „Bezeichner-Sprache“.

## Review Focus

- Leeren einer Frist (Feld fehlt im PUT, Vollersatz) muss als Wechsel „N Tage → keine“ zählen. Test in Task 2.
- Eine abgewiesene Anfrage (409 Skelett ohne Bestätigung, 400 außer Bereich) schreibt nichts. Test in Task 2.
- Zwei Fristen in einer Anfrage ergeben zwei Zeilen. Test in Task 2.
- Ein PUT, der nur ein anderes Feld ändert (z. B. `zeitzone`) und die Fristen mitschickt, schreibt nichts. Test in Task 2.
- Alte Detailtexte ohne `tage*` bleiben lesbar (`fristText` gibt `undefined`). Test in Task 3.

---

### Task 1: Aktionen, Angaben, Migration

**Files:**
- Modify: `src/auth/admin_audit.rs` (Enum `AdminAktion`, Struct `ZugangsAngaben`)
- Create: `migrations/0392_admin_audit_fristen.sql`
- Modify: `tests/enum_wire_kontrakt.rs` (Liste `AdminAktion`)

**Interfaces:**
- Produces: `AdminAktion::{AufbewahrungFristGeaendert, SkelettFristGeaendert, NachbereitungFristGeaendert}`; `ZugangsAngaben.tage_vorher: Option<i64>`, `ZugangsAngaben.tage: Option<i64>` (serde default, skip if none).

- [x] **Step 1:** Varianten und Felder ergänzen, Kontrakt-Liste erweitern. `jede_aktion_passiert_den_db_check` ist der rote Test (CHECK kennt die Werte nicht).
- [x] **Step 2:** `cargo test --lib jede_aktion_passiert_den_db_check` → FAIL (CHECK constraint).
- [x] **Step 3:** Migration 0392 als Kopie von 0386 mit den drei Werten im CHECK, Kopf „LLH-2140“.
- [x] **Step 4:** `cargo test --lib admin_audit` und `cargo test --test enum_wire_kontrakt` → PASS.
- [x] **Step 5:** Commit.

### Task 2: Vorher-Stand und Spur beim Speichern

**Files:**
- Modify: `src/org/einstellungen.rs` (`speichern`, `Gespeichert`, Tests)
- Modify: `src/routes/org_einstellungen.rs` (`setzen`)
- Test: `tests/org_einstellungen.rs`

**Interfaces:**
- Consumes: Task 1.
- Produces: `pub struct Fristen { pub aufbewahrung: Option<i64>, pub skelett: Option<i64>, pub nachbereitung: Option<i64> }` und `OrgEinstellungen::fristen(&self) -> Fristen` in `src/org/einstellungen.rs`; `Gespeichert.fristen_vorher: Fristen`.

- [ ] **Step 1: Failing tests**
  - Unit `fristen_vorher_kommt_aus_der_speicher_transaktion`: erstes Speichern mit `skelett_dauer_tage: Some(3650)` → `fristen_vorher.skelett == None`, Endstand 3650; zweites mit `Some(365)` → `fristen_vorher.skelett == Some(3650)`.
  - Integration `fristen_aendern_schreibt_die_admin_spur_nur_bei_wechsel`: PUT `{retention 365, skelett 3650 bestätigt, nachbereitung 30}` → drei Zeilen (`aufbewahrung_frist_geaendert`/`aufbewahrung_frist`, `{tage:365}`, …); gleicher PUT erneut plus `zeitzone: "UTC"` → keine neue Zeile; PUT `{skelett 365}` ohne Bestätigung → 409, keine Zeile; PUT `{retention 365, skelett 365 bestätigt}` → zwei Zeilen: Skelett `{tage_vorher:3650,tage:365}`, Nachbereitung `{tage_vorher:30}`; `akteur_name == "admin"`.
  - Integration `fristen_als_fuehrungskraft_schreiben_keine_spur`: 403, keine Zeile.
- [ ] **Step 2:** `cargo test --test org_einstellungen fristen` → FAIL.
- [ ] **Step 3:** `fristen_vorher = vorher.fristen()` in der Transaktion; im Handler nach der Ortung je Frist `(alt, neu, aktion, ziel)` vergleichen und bei `alt != neu` `schreibe` mit `ZugangsAngaben { tage_vorher: alt, tage: neu, ..Default::default() }`.
- [ ] **Step 4:** `cargo test --test org_einstellungen` und `cargo test --lib org::einstellungen` → PASS.
- [ ] **Step 5:** Commit.

### Task 3: Zugangsprotokoll, Typen, Doku

**Files:**
- Modify: `frontend/src/api/types.generated.ts` (+ zweite generierte Datei, via `scripts/check-typ-codegen.sh`)
- Modify: `frontend/src/zugangsprotokoll/zugangsprotokollText.ts`, `.test.ts`, `ZugangsprotokollPage.tsx`
- Modify: `docs/anwender/kapitel/zugangsprotokoll.md`

**Interfaces:**
- Consumes: Task 1 (Wire).
- Produces: `export function fristText(a: ZugangsAngaben): string | undefined`.

- [ ] **Step 1:** Typen erzeugen (`scripts/check-typ-codegen.sh --fix` bzw. wie das Skript es nennt); Typecheck bricht an `AKTION_TEXT`.
- [ ] **Step 2: Failing tests** in `zugangsprotokollText.test.ts`: `AKTION_TEXT.skelett_frist_geaendert === 'Skelett-Frist geändert'` (und die beiden anderen); `fristText({tage:365}) === 'keine → 365 Tage'`, `fristText({tage_vorher:3650,tage:365}) === '3650 → 365 Tage'`, `fristText({tage_vorher:365}) === '365 Tage → keine'`, `fristText({tage_vorher:2,tage:1}) === '2 → 1 Tag'`, `fristText({tage:1}) === 'keine → 1 Tag'`, `fristText({}) === undefined`; `hasNamensziel('skelett_frist_geaendert') === false`.
- [ ] **Step 3:** Texte und `fristText` umsetzen; in `AngabenAnzeige` `rollen ?? fristText(angaben) ?? instanzText(angaben) ?? leer`. Format: bei beiden Werten „A → B Tage“ (Einheit einmal am Ende, Einzahl nach B), sonst je Seite mit Einheit.
- [ ] **Step 4:** `mise exec -- pnpm -C frontend exec vitest run src/zugangsprotokoll` und `pnpm -C frontend typecheck` → PASS.
- [ ] **Step 5:** Doku-Eintrag in `zugangsprotokoll.md` (nach dem Ortungs-Eintrag), dann Commit.

### Task 4: Gate

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
