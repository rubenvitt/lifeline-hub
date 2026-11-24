# NINA-Fachebene je Instanz abschaltbar (LLH-2104) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Server-Flag `--nina`/`LIFELINE_NINA` (Vorgabe an) schaltet die Fachebene `nina` ab: kein Abruf bei warnung.bund.de, Route 404, Lagekarte ohne die Ebene.

**Architecture:** `FachebenenState` trägt die Menge der abgeschalteten Ebenen und eine umlenkbare NINA-Basis-URL. Die Route `fachebenen` prüft die Menge vor jedem Abruf, `GET /api/map/config` meldet sie. Das Frontend nimmt die Menge aus der Config, blendet die Ebenen im Ebenenbaum aus und behandelt ihre Sichtbarkeit als `false`.

**Tech Stack:** Rust (axum, clap, reqwest, sqlx), React/TypeScript (react-query, vitest).

**Spec:** `docs/superpowers/specs/2026-11-24-mldrihme-nina-ebene-abschaltbar-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/mldrihmesop4hlx1vdi243mr

## Global Constraints

- Vorgabe des Flags: **an** (`default_value_t = true`); Env nimmt `true`/`false` (`clap::ArgAction::Set`).
- Abgeschaltete Route: `AppError::NotFound("Fachebene abgeschaltet")`, vor jedem Cache- oder Netzzugriff.
- Neues Config-Feld heißt `fachebenen_abgeschaltet: Vec<String>` (Sprache des Bestandstyps `KarteConfigAntwort`).
- Gespeicherte Sichtbarkeiten (`fachebenen_sichtbar`, Ansichten) werden nicht umgeschrieben.
- Nach der DTO-Änderung `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten.
- Prosa, Kommentare, Testnamen deutsch; Strukturwörter englisch, Fachwörter deutsch (`is_abgeschaltet`, `mit_nina_basis_url`).

## Review Focus

- Gespeicherte Ansicht mit `nina: true` bei abgeschalteter Ebene: kein Request an `/api/map/overlays/nina`, keine Zeile im Ebenenbaum → Test in Task 4.
- Gruppe „Warnungen“ (`nina`, `dwd`) zählt nach dem Ausblenden nur DWD; „an“-Zähler der Fachebenen zählt NINA nicht mit → Test in Task 4.
- Bedingte Anfrage (`If-None-Match`) an eine abgeschaltete Ebene: trotzdem 404, nie 304 → Test in Task 2.
- Unbekannte Quelle bleibt 400 auch bei gesetzter Abschaltmenge → bestehender Test `fachebenen_unbekannte_quelle_ist_400` läuft weiter.
- Config ohne Feld (alter Server, neuer Client): Frontend behandelt `undefined` wie `[]` → Test in Task 4.

---

### Task 1: NINA-Basis-URL umlenkbar

**Files:**
- Modify: `src/karte/mod.rs` (`FachebenenState`, `neu()`, neue Konstante, Builder)
- Modify: `src/karte/quellen.rs:427-507` (NINA-URLs aus dem State)
- Test: `tests/karte.rs` (Abschnitt `/api/map/overlays`)

**Interfaces:**
- Produces: `pub const NINA_BASIS_URL: &str = "https://warnung.bund.de/api31";`, Feld `pub nina_basis_url: Arc<str>`, `pub fn mit_nina_basis_url(self, url: &str) -> Self` (trimmt `/` am Ende wie die Geschwister). `erneuere_nina(client, pool, basis: Arc<str>)` holt `{basis}/mowas/mapData.json` und `{basis}/warnings/{id}.geojson`.
- Produces (Test-Helfer in `tests/karte.rs`): `async fn nina_attrappe() -> (String, Arc<AtomicUsize>)` — axum-Stub auf `127.0.0.1:0`, `/mowas/mapData.json` → `[]`, zählt jede Anfrage; liefert Basis-URL und Zähler.

- [ ] **Step 1: Test `nina_eingeschaltet_fragt_die_quelle_ab`**: Router mit `fachebenen: FachebenenState::neu().mit_nina_basis_url(&basis)` (frisches `karten_dir`), `GET /api/map/overlays/nina` → 200, `zaehler.load() >= 1`.
- [ ] **Step 2:** `cargo test --test karte nina_` → FAIL (kompiliert nicht: `mit_nina_basis_url` fehlt).
- [ ] **Step 3:** Feld, Konstante, Builder; `NINA_MAPDATA`/`nina_geojson_url` durch Basis-URL ersetzen, `fetch_nina` reicht `s.nina_basis_url.clone()` weiter.
- [ ] **Step 4:** `cargo test --test karte nina_` → PASS; `cargo test --lib karte::quellen` → PASS.
- [ ] **Step 5:** Commit `refactor: NINA-Basis-URL im FachebenenState (LLH-2104)`.

### Task 2: Abschaltmenge, Route 404, Config-Feld

**Files:**
- Modify: `src/karte/mod.rs`, `src/routes/karte.rs` (`fachebenen`, `config`, `KarteConfigAntwort`)
- Modify: generierte Typen (`scripts/check-typ-codegen.sh` nennt die Dateien)
- Test: `tests/karte.rs`

**Interfaces:**
- Consumes: `nina_attrappe`, `mit_nina_basis_url` aus Task 1.
- Produces: Feld `pub abgeschaltet: Arc<[&'static str]>` (leer in `neu()`), `pub fn mit_abgeschaltet(self, quellen: &[&'static str]) -> Self`, `pub fn is_abgeschaltet(&self, quelle: &str) -> bool`; `KarteConfigAntwort.fachebenen_abgeschaltet: Vec<String>`.

- [ ] **Step 1: Tests**
  - `abgeschaltete_nina_ist_404_ohne_abruf`: State `.mit_nina_basis_url(&basis).mit_abgeschaltet(&["nina"])`; `GET /api/map/overlays/nina` → 404, `zaehler == 0`.
  - `abgeschaltete_nina_ist_auch_bedingt_404`: gleiche App, `anfrage_bedingt(&app, "/api/map/overlays/nina", "\"x\"")` → 404.
  - `config_meldet_abgeschaltete_fachebenen`: mit Abschaltung `json["fachebenen_abgeschaltet"] == ["nina"]`, ohne `== []`.
- [ ] **Step 2:** `cargo test --test karte abgeschaltet config_meldet` → FAIL.
- [ ] **Step 3:** Prüfung in `fachebenen` als erste Zeile des Handlers; Feld in `config` aus `state.fachebenen.abgeschaltet`. Doc-Kommentar des Feldes: welche Ebenen der Betreiber abgeschaltet hat (LLH-2104); das Frontend blendet sie aus.
- [ ] **Step 4:** Tests PASS; `scripts/check-typ-codegen.sh` → grün nach Regenerieren.
- [ ] **Step 5:** Commit `feat: abgeschaltete Fachebenen in Route und Config (LLH-2104)`.

### Task 3: Flag `--nina`

**Files:**
- Modify: `src/config.rs` (Feld nach `kritis_extrakt`, Tests im `mod tests`)
- Modify: `src/main.rs:613` (State-Bau)

**Interfaces:**
- Consumes: `mit_abgeschaltet` aus Task 2.
- Produces: `Config.nina: bool`.

- [ ] **Step 1: Tests** in `src/config.rs`: `nina_ist_vorgabe_an` (`parse_hermetisch(["lifeline-hub"]).nina == true`), `nina_false_schaltet_ab` (`--nina false` → `false`), `nina_env_false_schaltet_ab` (`parse_mit_env("LIFELINE_NINA","false",…)` → `false`).
- [ ] **Step 2:** `cargo test --lib config::tests::nina` → FAIL.
- [ ] **Step 3:** Feld mit Doc-Kommentar (Hilfetext): NINA/MoWaS-Ebene; **Vorgabe an**. Auflage des BBK: MoWaS-Meldungen nur inhaltlich unverändert und nicht zu gewerblichen Zwecken; Hilfsorganisationen, Behörden und BOS sind nicht betroffen, ein gewerblicher Betreiber schaltet mit `--nina false` bzw. `LIFELINE_NINA=false` ab. Abgeschaltet ruft die Instanz warnung.bund.de nie ab, die Route antwortet 404, die Lagekarte zeigt die Ebene nicht. In `main.rs`: bei `!config.nina` `.mit_abgeschaltet(&["nina"])` und `tracing::info!("Fachebene NINA abgeschaltet (--nina false): kein Abruf bei warnung.bund.de")`.
- [ ] **Step 4:** Tests PASS; `cargo build` grün.
- [ ] **Step 5:** Commit `feat: Flag --nina schaltet die NINA-Fachebene ab (LLH-2104)`.

### Task 4: Frontend blendet abgeschaltete Ebenen aus

**Files:**
- Modify: `frontend/src/pages/lagekarte/fachebenen.ts` (reine Funktion)
- Modify: `frontend/src/pages/LagekartePage.tsx:262-336,1700,2041`
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx`, `frontend/src/pages/lagekarte/Ebenenbaum.tsx:383-397`
- Test: `frontend/src/pages/lagekarte/fachebenen.test.ts`, Ebenenbaum-Test (bestehende Datei der Sidebar/Ebenenbaum-Tests)

**Interfaces:**
- Consumes: `KarteConfigAntwort.fachebenen_abgeschaltet` (generiert, Task 2).
- Produces: `export function ohneAbgeschaltete(sichtbar: FachebenenSichtbar, abgeschaltet: readonly string[] | undefined): FachebenenSichtbar` (gibt bei leerer/fehlender Liste dasselbe Objekt zurück); Prop `fachebenenAbgeschaltet?: readonly string[]` an `Sidebar` und `Ebenenbaum`.

- [ ] **Step 1: Tests**
  - `ohneAbgeschaltete`: `{nina:true,dwd:true,…}` mit `['nina']` → `nina:false, dwd:true`; mit `undefined` und `[]` → identisches Objekt (`toBe`).
  - Ebenenbaum mit `fachebenenAbgeschaltet={['nina']}`: kein Eintrag mit `FACHEBENEN.nina.label`, Gruppe „Warnungen“ zeigt nur DWD; ohne Prop bleibt NINA da.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/pages/lagekarte/fachebenen.test.ts <ebenenbaum-test>` → FAIL.
- [ ] **Step 3:** In `LagekartePage` `const fachebenenWirksam = useMemo(() => ohneAbgeschaltete(fachebenenSichtbar, config?.fachebenen_abgeschaltet), …)` und an `useFachebenen`, `braucheViewportBbox` und `Sidebar` reichen (Setter bleibt der ursprüngliche); `Sidebar` reicht `fachebenenAbgeschaltet` an `Ebenenbaum`; `Ebenenbaum` filtert `g.ebenen` und lässt leere Gruppen weg.
- [ ] **Step 4:** Tests PASS; `mise exec -- pnpm -C frontend exec tsc -b` und Lint grün.
- [ ] **Step 5:** Commit `feat: Lagekarte blendet abgeschaltete Fachebenen aus (LLH-2104)`.

### Task 5: Doku und Gates

**Files:**
- Modify: `docs/fachebenen-quellen.md` (Zeile NINA, Abschnitt NINA), `CHANGELOG.md`. `docs/betrieb/env-registry.md` führt nur sicherheitsrelevante Schalter; `LIFELINE_KRITIS_EXTRAKT` steht dort auch nicht, also bleibt NINA draußen.
- Prüfen: `docs/architektur/AGENTS.md` (Mitänderungsregel), `docs/anwender/` (erwähnt ein Kapitel die NINA-Ebene? dann ein Satz zum Fehlen bei abgeschalteter Instanz)

- [ ] **Step 1:** NINA-Zeile: „Vorgabe an; gewerbliche Betreiber schalten mit `--nina false`/`LIFELINE_NINA=false` ab (LLH-2104): kein Abruf, Route 404, Ebene fehlt in der Lagekarte.“ CHANGELOG-Eintrag unter dem offenen Abschnitt.
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 3:** Commit `docs: NINA-Abschaltung in Quellen-Doku und Changelog (LLH-2104)`.
