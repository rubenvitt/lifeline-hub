# Schlüsselwechsel für den Geheimnisspeicher der Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Betreiber tauscht den Schlüssel des Geheimnisspeichers mit einem Neustart (neuer
Schlüssel + `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT`), ohne ein Geheimnis neu zu setzen; beide
Schlüssel lassen sich auch aus einer Datei laden.

**Architecture:** `Geheimnisspeicher` trägt optional einen alten Schlüssel und liest nach
Fingerabdruck. `Config` löst Wert oder Datei je Rolle zu einem Speicher auf. Vor dem Adapter-Lauf
schlüsselt `adapter::lauf::umschluesseln` alle Chiffrate des alten Schlüssels in einer Transaktion
um. Verwaltung, API und Frontend bleiben unverändert.

**Tech Stack:** Rust, `age` (x25519), clap 4, sqlx/SQLite, tokio.

**Spec:** `docs/superpowers/specs/2026-11-22-z211l8p5-schluesselwechsel-geheimnisspeicher-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/z211l8p5cw3oc2zkj34r2rwx

## Global Constraints

- Nie ein Schlüssel oder Klartext in Log, Fehlertext, clap-Meldung, `Debug` oder API; Log nennt
  nur Fingerabdrücke, Anzahlen, Pfade und Dateimodus.
- Variablen und Flags genau: `LIFELINE_GEHEIMNIS_SCHLUESSEL_DATEI` / `--geheimnis-schluessel-datei`,
  `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT` / `--geheimnis-schluessel-alt`,
  `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT_DATEI` / `--geheimnis-schluessel-alt-datei`; alle mit
  `hide_env_values = true`.
- Kein Frontend-, DTO- oder Codegen-Diff; `count_fremde_chiffrate`/`has_fremde_chiffrate`
  bleiben unverändert (vergleichen nur mit dem neuen Fingerabdruck).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“).
- Entschlüsseln und Verschlüsseln im async-Kontext über `spawn_blocking` (ADR-0051); entschlüsselt
  wird nur in `adapter::lauf` (`src/AGENTS.md`, „Backend — Adapter“).
- Tests in `src/config.rs` parsen nur über `parse_hermetisch`/`parse_mit_env`/`try_parse_mit_env`
  (Wächter `parse_nur_ueber_die_gesperrten_helfer`).

## Review Focus

1. Schlüsseldatei mit CRLF-Zeilenenden oder Leerzeichen am Zeilenende → wird gelesen (Task 2).
2. Leer gesetzte `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT` (Compose `${…:-}`) → verhält sich genau wie eine
   leer gesetzte `LIFELINE_GEHEIMNIS_SCHLUESSEL` heute (Task 3).
3. Schlüsseldatei fehlt oder ist für den Prozess nicht lesbar → Start bricht mit Rolle und Pfad ab,
   ohne Inhalt (Task 3).
4. Zweiter Start mit noch gesetztem `…_ALT` nach erfolgreichem Umschlüsseln → nichts geändert,
   Hinweis „kann entfernt werden“ (Task 4).
5. Ein Admin setzt während des Wechsels ein Geheimnis → es liegt am neuen Schlüssel (Task 1).

---

### Task 1: Speicher mit altem Schlüssel

**Files:**
- Modify: `src/adapter/geheimnis.rs` (Struktur `Geheimnisspeicher`, `decrypt`, `Debug`, Tests)

**Interfaces:**
- Produces:
  - `Geheimnisspeicher::new_wechsel(neu: GeheimnisSchluessel, alt: GeheimnisSchluessel) -> Result<Geheimnisspeicher, SchluesselFehler>`
    — `Err(SchluesselFehler("alter und neuer Schlüssel sind derselbe"))` bei gleichem Fingerabdruck.
  - `Geheimnisspeicher::fingerabdruck_alt(&self) -> Option<&str>`
  - `Geheimnisspeicher::new(Option<GeheimnisSchluessel>)`, `fingerabdruck()`, `has_schluessel()`,
    `encrypt()` unverändert in Signatur; `fingerabdruck`/`has_schluessel`/`encrypt` beziehen sich
    nur auf den neuen.

- [x] **Step 1: Failing tests** in `mod tests`:
  - `wechsel_liest_alte_und_neue_chiffrate`: `a` = Speicher nur mit Schlüssel A, Chiffrat `ca, fa`;
    `w = new_wechsel(B, A)`; `w.decrypt(&ca, &fa)` == Klartext; `w.fingerabdruck()` == Fp von B;
    `w.fingerabdruck_alt()` == `Some(fa)`.
  - `wechsel_schreibt_nur_mit_dem_neuen`: `w.encrypt(x)` liefert Fp von B; ein Speicher nur mit A
    öffnet es nicht (`Unlesbar`), ein Speicher nur mit B öffnet es.
  - `wechsel_mit_gleichem_schluessel_ist_fehler`: `new_wechsel(A.clone(), A)` ist `Err`, Text
    enthält „derselbe“.
  - `debug_zeigt_keinen_schluessel` erweitern: `format!("{w:?}")` enthält keinen der beiden
    Schlüsseltexte, aber beide Fingerabdrücke.
- [x] **Step 2:** `cargo test --lib adapter::geheimnis` → FAIL (`new_wechsel` fehlt).
- [x] **Step 3: Implementieren.** `Geheimnisspeicher(Option<Arc<Geladen>>)` bekommt den alten als
  zweites Feld (z. B. `struct Geheimnisspeicher { neu: Option<Arc<Geladen>>, alt: Option<Arc<Geladen>> }`);
  `Geladen` aus `GeheimnisSchluessel` per gemeinsamer Hilfsfunktion. `decrypt` wählt `neu` oder
  `alt` nach `fingerabdruck == fp`, sonst `Unlesbar`. `Debug`: `Geheimnisspeicher(<fp>)` bzw.
  `Geheimnisspeicher(<fp>, alt <fp_alt>)`. `Default` bleibt „ohne Schlüssel“.
- [x] **Step 4:** `cargo test --lib adapter::geheimnis` → PASS.
- [x] **Step 5: Commit** `feat(adapter): Geheimnisspeicher liest mit altem und neuem Schlüssel`.

### Task 2: Schlüsseldatei lesen

**Files:**
- Modify: `src/adapter/geheimnis.rs`

**Interfaces:**
- Produces:
  - `pub fn parse_schluesseldatei(inhalt: &str) -> Result<GeheimnisSchluessel, SchluesselFehler>`
    — überspringt leere Zeilen und Zeilen, die (nach `trim`) mit `#` beginnen; genau eine
    verbleibende Zeile, über `GeheimnisSchluessel::from_str`. Keine → `SchluesselFehler("keine
    Schlüsselzeile in der Datei")`, mehrere → `SchluesselFehler("mehr als eine Schlüsselzeile in
    der Datei")`.
  - `pub fn read_schluesseldatei(pfad: &Path) -> Result<GeheimnisSchluessel, SchluesselFehler>` —
    `std::fs::read_to_string`, IO-Fehler → `SchluesselFehler("Datei nicht lesbar")`, sonst
    `parse_schluesseldatei`.
  - `pub fn offener_modus(pfad: &Path) -> Option<u32>` — unter `cfg(unix)` `Some(mode & 0o777)`,
    wenn `mode & 0o077 != 0` (folgt Symlinks, `std::fs::metadata`); sonst und auf anderen
    Plattformen `None`.

- [x] **Step 1: Failing tests:**
  - `schluesseldatei_im_format_von_age_keygen`: Inhalt `"# created: 2026-11-22T10:00:00+01:00\n# public key: age1…\n<KEY>\n"` → Ok, gleicher Fingerabdruck wie `<KEY>`.
  - `schluesseldatei_mit_crlf_und_leerzeichen`: `"# x\r\n<KEY>  \r\n\r\n"` → Ok.
  - `schluesseldatei_ohne_oder_mit_zwei_schluesseln`: nur Kommentare → Err „keine“; zwei Schlüssel → Err „mehr als eine“; Fehlertext enthält keinen der Schlüssel.
  - `schluesseldatei_mit_kaputtem_schluessel_nennt_ihn_nicht`: `"AGE-SECRET-KEY-1kaputt"` → Err, Text ohne „kaputt“.
  - `#[cfg(unix)] offene_rechte_werden_erkannt`: Datei in `tempfile::tempdir()` mit `0o600` → `None`; mit `0o644` → `Some(0o644)`.
- [x] **Step 2:** `cargo test --lib adapter::geheimnis` → FAIL.
- [x] **Step 3:** Die drei Funktionen implementieren (prüfen, ob `tempfile` schon dev-dependency ist; sonst `std::env::temp_dir()` mit eindeutigem Namen).
- [x] **Step 4:** `cargo test --lib adapter::geheimnis` → PASS.
- [x] **Step 5: Commit** `feat(adapter): Schlüssel des Geheimnisspeichers aus einer Datei lesen`.

### Task 3: Konfiguration und Start-Auflösung

**Files:**
- Modify: `src/config.rs` (Felder nach `geheimnis_schluessel`, `GeheimnisSchluesselParser`, neue Methode, Tests)

**Interfaces:**
- Consumes: Task 1 `new_wechsel`, Task 2 `read_schluesseldatei`, `offener_modus`.
- Produces:
  - Felder `geheimnis_schluessel_datei: Option<PathBuf>` (`conflicts_with = "geheimnis_schluessel"`),
    `geheimnis_schluessel_alt: Option<GeheimnisSchluessel>`,
    `geheimnis_schluessel_alt_datei: Option<PathBuf>` (`conflicts_with = "geheimnis_schluessel_alt"`).
  - `GeheimnisSchluesselParser { flag: &'static str, env: &'static str }` — Fehlertext
    `"{flag} ({env}): {grund}"`, für neu und alt.
  - `impl Config { pub fn load_geheimnisspeicher(&self) -> Result<(Geheimnisspeicher, Vec<String>), String> }`
    — zweites Element: Warnungen für das Log (offene Dateirechte), je
    `"Schlüsseldatei {pfad} ist für Gruppe oder andere lesbar (Modus {modus:o}): chmod 600"`.
    Fehler (Text für `anyhow::bail!`, nie ein Wert):
    - Datei: `"{flag} ({env}): {pfad}: {grund}"`
    - alt ohne neu: `"alter Schlüssel des Geheimnisspeichers ohne neuen: erst LIFELINE_GEHEIMNIS_SCHLUESSEL oder LIFELINE_GEHEIMNIS_SCHLUESSEL_DATEI setzen"`
    - gleich: `"LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT: alter und neuer Schlüssel sind derselbe"`

- [x] **Step 1: Failing tests** (`mod tests`, nur über die gesperrten Helfer; Schlüssel per CLI-Flag in `parse_hermetisch([...])`):
  - `geheimnis_schluessel_aus_datei`: Datei mit `<KEY>` (Modus 600) → `load_geheimnisspeicher()` Ok, Fingerabdruck von `<KEY>`, keine Warnung.
  - `#[cfg(unix)] offene_schluesseldatei_warnt`: Modus 644 → Ok, eine Warnung mit Pfad und `644`, ohne `<KEY>`.
  - `wert_und_datei_zugleich_ist_fehler`: `--geheimnis-schluessel <KEY> --geheimnis-schluessel-datei <p>` über `try_parse_mit_env` (beliebige harmlose Variable) → `Err`; ebenso für alt.
  - `alter_ohne_neuen_ist_fehler` und `alter_gleich_neuem_ist_fehler`: `Err` mit den Texten oben, ohne `<KEY>`.
  - `fehlende_schluesseldatei_nennt_pfad`: Pfad existiert nicht → `Err` enthält Pfad und „nicht lesbar“.
  - `wechsel_aus_env_und_datei`: neu per Datei, alt per Flag → Ok, `fingerabdruck_alt()` == Fp von alt.
  - `leerer_alter_schluessel_wie_leerer_neuer`: `try_parse_mit_env("LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT", "", …).is_ok()` == `try_parse_mit_env("LIFELINE_GEHEIMNIS_SCHLUESSEL", "", …).is_ok()`.
  - `kaputter_alter_schluessel_steht_nicht_im_fehler`: `--geheimnis-schluessel-alt AGE-SECRET-KEY-1kaputt` → Err mit „--geheimnis-schluessel-alt (LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT)“, ohne „kaputt“.
- [x] **Step 2:** `cargo test --lib config` → FAIL.
- [x] **Step 3:** Felder, Parser und Methode implementieren; Doc-Kommentare der Felder im Stil des bestehenden `geheimnis_schluessel` (wofür, was ohne Angabe gilt, dass Datei und Wert sich ausschließen). Die Datei liest nur `load_geheimnisspeicher`, nicht der Parser.
- [x] **Step 4:** `cargo test --lib config` → PASS.
- [x] **Step 5: Commit** `feat(config): Schlüssel des Geheimnisspeichers aus Datei und alter Schlüssel für den Wechsel`.

### Task 4: Umschlüsseln beim Start

**Files:**
- Modify: `src/adapter/repo.rs` (zwei SQL-Funktionen)
- Modify: `src/adapter/lauf.rs` (neben `beim_start`)
- Modify: `src/main.rs:337-368` (Speicher über `load_geheimnisspeicher`, Umschlüsseln, Log)
- Create: `tests/adapter_schluesselwechsel.rs`

**Interfaces:**
- Consumes: Task 1, Task 3.
- Produces:
  - `repo::load_chiffrate_mit_fp(conn: &mut SqliteConnection, fingerabdruck: &str) -> Result<Vec<(String, String, Vec<u8>)>, sqlx::Error>` — `(adapter_id, name, chiffrat)`.
  - `repo::update_chiffrat(conn: &mut SqliteConnection, adapter_id: &str, name: &str, chiffrat: &[u8], fp_neu: &str, fp_alt: &str) -> Result<bool, sqlx::Error>` — `UPDATE adapter_geheimnis SET chiffrat = ?, schluessel_fp = ? WHERE adapter_id = ? AND name = ? AND schluessel_fp = ?`; `gesetzt_at`, `gesetzt_von`, `adapter.stand` unberührt.
  - `#[derive(Debug, Default, PartialEq, Eq)] pub struct Umschluesselt { pub umgeschluesselt: u64, pub unlesbar: u64 }` in `lauf.rs`.
  - `lauf::umschluesseln(pool: &SqlitePool, speicher: &Geheimnisspeicher) -> Result<Umschluesselt, sqlx::Error>` — ohne alten Schlüssel `Ok(Default)`; sonst eine Transaktion `pool.begin_with("BEGIN IMMEDIATE")`, je Zeile `decrypt` mit altem Fp und `encrypt` (beides in einem `spawn_blocking` je Zeile), `update_chiffrat`, Commit. Nicht zu öffnende Zeile: zählen, unverändert lassen.

- [x] **Step 1: Failing integration tests** in `tests/adapter_schluesselwechsel.rs` (Aufbau wie `tests/adapter_lauf.rs`: `mod adapter_testart; mod common;`, `setup_mit_state`, Geheimnis per `PUT …/geheimnisse/token`):
  - `wechsel_schluesselt_um_und_adapter_laeuft_weiter`: Adapter mit Token unter Schlüssel A; `w = rahmen` mit `new_wechsel(B, A)`; `umschluesseln(&pool, &w.speicher)` == `{umgeschluesselt: 1, unlesbar: 0}`; `schluessel_fp` aller Zeilen == Fp von B; `durchgang` mit Rahmen nur B → Abruf sah das Token (`art.gesehen()`), Zustand nicht angehalten; Router mit Rahmen nur B (wie `adapter_admin.rs` „anderer Schlüssel“): `speicher == "bereit"`, `is_unlesbar == false`.
  - `zweiter_lauf_aendert_nichts`: nach dem ersten Umschlüsseln erneut → `Default`; `chiffrat` byte-gleich.
  - `kaputte_zeile_bleibt`: zusätzliche Zeile per SQL mit Fp von A und `chiffrat = x'00'` → `{umgeschluesselt: 1, unlesbar: 1}`; die kaputte trägt weiter Fp von A; `count_fremde_chiffrate(&pool, Some(fp_b))` == 1.
  - `ohne_alten_schluessel_nichts`: Rahmen nur mit A → `Default`, Zeile unverändert.
  - `gesetzt_von_und_stand_bleiben`: `gesetzt_at`, `gesetzt_von` der Zeile und `adapter.stand` vor und nach gleich.
- [x] **Step 2:** `cargo test --test adapter_schluesselwechsel` → FAIL (Kompilierfehler `umschluesseln`).
- [x] **Step 3:** Repo-Funktionen und `umschluesseln` implementieren.
- [x] **Step 4:** `src/main.rs`: `let (speicher, warnungen) = config.load_geheimnisspeicher().map_err(|e| anyhow::anyhow!(e))?;` je Warnung `tracing::warn!`; vor `count_fremde_chiffrate`: `umschluesseln` aufrufen. Log:
  - Ok mit `unlesbar == 0`: info, Felder `alt`, `neu`, `anzahl`, Text „Geheimnisse der Adapter auf den neuen Schlüssel umgeschlüsselt; LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT kann entfernt werden“.
  - `unlesbar > 0`: zusätzlich warn, Feld `anzahl`, „Geheimnisse ließen sich mit dem alten Schlüssel nicht öffnen: in der Verwaltung neu setzen“.
  - `Err(e)`: warn „Umschlüsseln der Adapter-Geheimnisse fehlgeschlagen, der Server liest mit beiden Schlüsseln: {e}“, Start läuft weiter.
  Nur ausführen, wenn `speicher.fingerabdruck_alt().is_some()`.
- [x] **Step 5:** `cargo test --test adapter_schluesselwechsel --test adapter_lauf --test adapter_admin` → PASS; `cargo build` grün.
- [x] **Step 6: Commit** `feat(adapter): Geheimnisse beim Start auf den neuen Schlüssel umschlüsseln`.

### Task 5: ADR, Regeln und Doku

**Files:**
- Modify: `docs/architektur/entscheidungen/ADR-0077-…md` (Regeln, `herleitung`, Prüfung; < 80 Zeilen)
- Modify: `src/AGENTS.md` („Backend — Adapter“, Punkt „Geheimnisse“: ein Satz zum Wechsel)
- Modify: `docs/architektur/05-*.md` (Zeile `src/adapter`: Konfiguration nennt `…_DATEI`, `…_ALT`)
- Modify: `docs/architektur/11-risiken-und-technische-schulden.md` (R47 auf den Rest, „LLH-2025 erledigt“, Stand-Zeile)
- Modify: `docs/betrieb/env-registry.md` (drei Zeilen, Liste der maskierten Geheimnisse)
- Modify: `docs/betrieb/backup-restore.md` („Geheimnisse der Adapter“: Wechsel in drei Schritten, Dateiquelle, alte Sicherungen brauchen den alten Schlüssel)

- [x] **Step 1:** `scripts/adr-fuer.sh` für alle geänderten Pfade laufen lassen; Mitänderungsregeln aus `docs/architektur/AGENTS.md` und, falls `docs/anwender/kapitel/anbindungen.md` den Schlüssel erklärt, `docs/anwender/AGENTS.md` prüfen und betroffene Stellen mitziehen.
- [x] **Step 2:** ADR-0077: Regel „Schlüssel nur aus der Umgebung“ ersetzen durch „MUST NOT: Der Schlüssel liegt in der Datenbank oder einer Sicherung; er kommt aus der Umgebung oder einer Datei, deren Pfad die Umgebung nennt.“; neue Regel „MUST: Für einen Wechsel lädt der Server höchstens einen alten Schlüssel zusätzlich, liest mit dem Schlüssel des passenden Fingerabdrucks, verschlüsselt nur mit dem neuen und schlüsselt beim Start alle Chiffrate des alten in einer Transaktion um.“; Prüfzeile `verlange 'fn umschluesseln\(' src/adapter/lauf.rs`; `herleitung` + Design-Doc und Zunder-Link.
- [x] **Step 3:** Übrige Doku nach den Dateien oben; Texte aus dem Design-Doc, Abschnitt „Doku“.
- [x] **Step 4:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (ein Aufruf; nicht mit `| tail`).
  Gelaufen am 22./23.11.2026 in der Cloud-Sitzung wegen des Plattenkontingents in Portionen: `--nur schnell` grün; Rust-Suite (lib, doc, alle 274 Integrationstests, übrige Crates) grün; Dev-Seed als `cargo check --all-targets` grün; Vitest nur die sieben Dateien, die `docs/anwender` lesen (96/96 grün), der Frontend-Code ist unverändert; `lifeline-desktop` nicht baubar (GTK fehlt im Container), `src-tauri` unverändert.
- [x] **Step 5: Commit** `docs: Schlüsselwechsel des Geheimnisspeichers in ADR-0077, Betrieb und Kapitel 11`.
