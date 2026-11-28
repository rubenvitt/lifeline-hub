# Matrix-Teilzustellung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ETB und Versandliste nennen „teilweise zugestellt (Text ja, n Anlagen nein)“, wenn ein Versand nach dem Text endgültig an einer Anlage scheitert.

**Architecture:** Der Lauf (`ausgang::lauf::run_one`) bestimmt beim endgültigen Fehlschlag aus Anlagenzahl und gesendeten Teilen (frühere ∪ dieser Versuch) `anlagen_offen`, schreibt es mit dem Ergebnis in die neue Spalte und formt den ETB-Text; die Versandliste liest die Spalte als `attachments_missing`.

**Tech Stack:** Rust (axum, sqlx/SQLite), React/TypeScript (antd, Vitest).

**Spec:** `docs/superpowers/specs/2026-11-28-c4tmpqw1-matrix-teilzustellung-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/c4tmpqw1xj8j0ig7es6qfek0

## Global Constraints

- Feste Texte, nie ein Text des Homeservers; Wortlaut „teilweise zugestellt (Text ja, n Anlagen nein)“, bei n = 1 „1 Anlage nein“.
- Zustand bleibt `fehlgeschlagen`; kein neuer `AusgangFehler`.
- Migration `0392_ausgang_anlagen_offen.sql`, nur `ALTER TABLE … ADD COLUMN` (keine bestehende Migration ändern).
- Wire-Feld englisch: `Versand.attachments_missing: Option<i64>`, `skip_serializing_if = "Option::is_none"`; nach der DTO-Änderung `scripts/check-typ-codegen.sh`, generierte Dateien mitcommitten.
- „unklar“ (`ungewiss`) behält seinen Wortlaut; E-Mail/Fax unverändert (SMTP meldet keine Teile, also nie teilweise).

## Review Focus

- Text aus früherem Versuch gesendet, endgültiger Fehlschlag in einem späteren ohne neue Teile → teilweise mit richtiger Zahl (Test in Task 1).
- „Erneut senden“ eines teilweise zugestellten Versands → Spalte leer, danach Erfolg ohne „teilweise“ (Test in Task 1).
- Text nicht gesendet, aber eine Anlage schon → kein „teilweise“ (Einheitstest in Task 1).
- Endgültiger Fehlschlag nach dem Text ohne Anlagen → kann nicht vorkommen; Funktion liefert `None` (Einheitstest in Task 1).
- Teilweise plus `ungewiss` → Wortlaut „unklar“ bleibt (Einheitstest in Task 1).

---

### Task 1: Backend — Spalte, Ergebnis, ETB-Text

**Files:**
- Create: `migrations/0392_ausgang_anlagen_offen.sql`
- Modify: `src/ausgang/repo.rs` (`ANZEIGE`, `AnzeigeZeile`, `From`, `Ergebnis::Fehlgeschlagen`, `save_ergebnis_tx`, `retry_tx`), `src/ausgang/mod.rs` (`Versand`), `src/ausgang/lauf.rs` (`nach_fehler`, `etb_text_mit`, `run_one`, alle `Ergebnis::Fehlgeschlagen`-Bildner/`fehlgeschlagen()`), `src/AGENTS.md` („Matrix-Zustellung“)
- Test: `src/ausgang/lauf.rs` (mod tests), `tests/ausgang_lauf.rs`

**Interfaces:**
- Produces: `fn anlagen_offen(anlagen: usize, gesendet: &[i64], neu: &[(i64, String)]) -> Option<i64>` in `lauf.rs` — `Some(n)` nur wenn Teil 0 in `gesendet ∪ neu` und n = Anzahl von `1..=anlagen` nicht darin, n > 0.
- Produces: `Ergebnis::Fehlgeschlagen { fehler, status, anlagen_offen: Option<i64> }`.
- Produces: Wire `Versand.attachments_missing: Option<i64>`.

- [ ] **Step 1: Failing unit tests in `lauf.rs` tests**
  - `anlagen_offen_nur_wenn_der_text_ging`: `(2, &[], &[(0,…)]) == Some(2)`, `(2, &[0], &[(1,…)]) == Some(1)`, `(2, &[], &[(1,…)]) == None`, `(0, &[0], &[]) == None`, `(2, &[0,1,2], &[]) == None`.
  - `etb_text_teilweise`: Matrix-Zeile, `etb_text_mit(&z, AusgangFehler::Voruebergehend, "Homeserver nicht erreichbar", Some(2))` endet auf `"teilweise zugestellt (Text ja, 2 Anlagen nein): Homeserver nicht erreichbar"`; mit `Some(1)` → `"(Text ja, 1 Anlage nein)"`; `Ungewiss` mit `Some(1)` → enthält `"Zustellung unklar"`, nicht „teilweise“.
- [ ] **Step 2:** `cargo test --lib ausgang::lauf` → FAIL (Funktion fehlt).
- [ ] **Step 3: Implement** `anlagen_offen`; `etb_text_mit` bekommt `teilweise: Option<i64>` (nur der `_`-Arm wird zu `"{ziel} teilweise zugestellt (Text ja, {n} {Anlage|Anlagen} nein): {grund}"`); übrige Aufrufer übergeben `None`. `nach_fehler` bekommt `teilweise: Option<i64>` und reicht es in `Ergebnis::Fehlgeschlagen` und ETB-Text; `run_one` berechnet es vor `drop(anhaenge)` aus `anhaenge.len()`, `gesendet`, `f.teile`.
- [ ] **Step 4:** Migration `ALTER TABLE ausgang ADD COLUMN anlagen_offen INTEGER CHECK (anlagen_offen IS NULL OR anlagen_offen > 0);` (Kopfkommentar wie 0390); `save_ergebnis_tx` schreibt sie bei `Fehlgeschlagen`, setzt NULL bei `Uebergeben`; `retry_tx` setzt NULL; `ANZEIGE`/`AnzeigeZeile`/`Versand` führen `attachments_missing`.
- [ ] **Step 5: Failing integration test** `tests/ausgang_lauf.rs::text_ging_anlage_endgueltig_nicht_heisst_teilweise_zugestellt`: Matrix-Anbindung, Lagebericht mit Anlage (`lagebericht_freigeben(true)`), `TeilDoppel` antwortet `Err(Fehlschlag { fehler: Zustellfehler::Abgelehnt, grund: "abgelehnt (M_UNKNOWN)", teile: [(0,"$text")] })`; danach Zeile `fehlgeschlagen`, `anlagen_offen` (per SQL) `== Some(1)`, ETB-Text endet auf `"teilweise zugestellt (Text ja, 1 Anlage nein): abgelehnt (M_UNKNOWN)"`. Dann `repo::retry_tx` → Spalte NULL.
- [ ] **Step 6:** `cargo test --test ausgang_lauf` und `cargo test --lib ausgang` → PASS.
- [ ] **Step 7:** `scripts/check-typ-codegen.sh`, generierte Dateien mit add; Regelzeile in `src/AGENTS.md`, „Matrix-Zustellung“. Commit `feat(ausgang): Matrix-Teilzustellung im ETB und in der Spalte anlagen_offen`.

### Task 2: Frontend — Versandliste

**Files:**
- Modify: `frontend/src/ausgang/Versandliste.tsx` (`versandZustandText`)
- Test: `frontend/src/ausgang/Versandliste.test.tsx`

**Interfaces:**
- Consumes: `Versand.attachments_missing?: number` (generiert in Task 1).

- [ ] **Step 1: Failing test** `zeigt teilweise zugestellt mit der Zahl der Anlagen`: `state: 'fehlgeschlagen', channel: 'matrix', error: 'abgelehnt', attachments_missing: 2` → `"teilweise zugestellt (Text ja, 2 Anlagen nein): " + ausgangFehlerText('abgelehnt', 'matrix')`; mit `1` → „1 Anlage nein“; ohne Feld unverändert „fehlgeschlagen: …“.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/ausgang/Versandliste.test.tsx` → FAIL.
- [ ] **Step 3:** In `versandZustandText` vor dem Fehlgeschlagen-Zweig (nach dem `ungewiss`-Zweig): bei `v.attachments_missing` den Teilweise-Text; Ton bleibt `alarm`.
- [ ] **Step 4:** Vitest → PASS; `mise exec -- pnpm -C frontend exec prettier --check src/ausgang`.
- [ ] **Step 5:** Commit `feat(ausgang): Versandliste zeigt teilweise zugestellt`.

### Task 3: Abschluss

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] Bild der Versandliste (Wegwerf-Spec oder Vitest-Render) für PR und Meldung.
