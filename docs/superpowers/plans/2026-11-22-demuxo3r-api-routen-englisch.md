# API-Routen auf Englisch – Fundament (LLH-1979) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regel, ADR, Glossar und Wächter für englische API-Routen einführen und als erstes Paket
Neuigkeiten (`versionsstand`) und Anmeldung (`auth`) mit hartem Schnitt umstellen.

**Architecture:** Ein Bash-Wächter liest die registrierten Pfade aus `src/app.rs`,
`src/public_api/**` und `…_PFAD`-Konstanten, schlägt jedes feste Segment im Glossar
`scripts/api-routen-woerter.tsv` nach und lässt nur Pfade aus dem schrumpfenden Bestand
`scripts/api-routen-bestand.txt` mit unbekannten Segmenten durch. Eingehängt in Schritt 14 von
`check-all.sh`. Die Pakete benennen Pfade ohne Alias um; der Hüllen-Vertrag steigt auf 2.

**Tech Stack:** Bash 3.2 + awk (Wächter), Rust/axum, React/TS (MSW, Playwright), Tauri, Swift.

**Spec:** `docs/superpowers/specs/2026-11-22-demuxo3r-api-routen-englisch-design.md`

## Global Constraints

- Harter Schnitt: kein Alias, keine doppelte Registrierung, kein `Deprecation`-Kopf.
- Glossar je Segment, Spalten `segment<TAB>deutsch`, beide eindeutig (außer `-`), sortiert nach
  `segment`, `segment` passt auf `^[a-z0-9]+([.-][a-z0-9]+)*$`.
- Bestand darf nur schrumpfen; keine Zeile, die auf `origin/alpha` fehlt.
- Bezeichner im Code, Wire-Felder, Pfadparameter-Namen und App-Routen bleiben unverändert.
- ADR-Nummer: nächste freie auf `origin/alpha` (Stand 22.11.2026: `ADR-0085`).
- Wurzel-`AGENTS.md` bleibt unter 200 Zeilen.
- Prosa, Kommentare, Commit-Nachrichten deutsch; jeder Commit-Body trägt
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/demuxo3rcnfmof9uvilczsnz`.

Pfadzuordnung des ersten Pakets (verbindlich):

| alt | neu |
| --- | --- |
| `/api/versionsstand` | `/api/release-notes` |
| `/api/versionsstand/gelesen` | `/api/release-notes/read` |
| `/api/auth/app-code/einloesen` | `/api/auth/app-code/redeem` |
| `/api/auth/passwort` | `/api/auth/password` |
| `/api/auth/passwort/festlegen` | `/api/auth/password/set` |
| `/api/auth/sitzungen` | `/api/auth/sessions` |
| `/api/auth/sitzungen/andere-beenden` | `/api/auth/sessions/end-others` |
| `/api/auth/sitzungen/{kennung}` | `/api/auth/sessions/{kennung}` |

## Review Focus

- Route mit mehrzeiliger Registrierung (`.route(\n "…",`) wird erkannt, nicht nur `.route("…"`
  in einer Zeile → Testfall in Task 1.
- Literale in `#[cfg(test)]`-Code von `src/app.rs` (`pfad_fuer_protokoll("/api/health")`,
  `format!("/api/v1/…")`) zählen nicht als Route → Testfall in Task 1.
- Ein alter Pfad bleibt irgendwo als String stehen (MSW-Standardhandler, e2e-Helfer,
  Hüllen-Skript) und der Test läuft trotzdem grün, weil er gegen einen Mock geht → `grep` auf
  alle alten Pfade als Abschlussschritt in Task 4 und 5.
- Ältere iOS-Hülle trifft neuen Server → `Vertragspruefung` ergibt `.zuNeu` für Vertrag 2 bei
  `bekannt: [1]` → Testfall in Task 5.
- Ohne `origin/alpha` (flacher Checkout) bricht der Wächter nicht ab, sondern überspringt den
  Bestandsvergleich laut → Testfall in Task 1.

---

### Task 1: Wächter, Glossar, Bestand

**Files:**
- Create: `scripts/check-api-routen.sh`, `scripts/check-api-routen.test.sh`
- Create: `scripts/api-routen-woerter.tsv`, `scripts/api-routen-bestand.txt`

**Interfaces:**
- Produces: `scripts/check-api-routen.sh [<repo-wurzel>] [--bestand]`. Ohne `--bestand`: Exit 0
  grün, Exit 1 rot mit je Befund einer Zeile `check-api-routen: <pfad>: Segment '<seg>' …`.
  Mit `--bestand`: gibt die registrierten Pfade mit unbekanntem Segment sortiert aus (Exit 0),
  zum Erzeugen und Kürzen der Bestandsdatei. Vergleichs-Ref fest `origin/alpha`.

- [x] **Step 1: Selbsttest schreiben** (`check-api-routen.test.sh`, Muster
  `check-schreibweisen.test.sh`: `baum_neu` legt ein Wegwerf-Repo mit `src/app.rs`,
  `src/public_api/routen.rs`, `src/instanz/extractor.rs`, Glossar und Bestand an, alles
  committet, `git update-ref refs/remotes/origin/alpha HEAD`; `fall <name> gruen|rot <befehl>
  [<muster>]`). Fälle:
  - grün: Ausgangsbaum (Routen `/api/health`, mehrzeilig `"/api/auth/login",`,
    `.route(MELDEN_PFAD`, `path = "/api/v1/me"`, deutscher Pfad `/api/einsaetze/{id}` im Bestand).
  - grün: `#[cfg(test)]`-Zeile `assert_eq!(f("/api/gibtsnicht"), …)` und `format!("/api/xyz/{a}")`.
  - rot `'/api/neu-deutsch'`: neue Route `.route("/api/neu-deutsch", get(h))`.
  - rot: neue mehrzeilige Route `"/api/abc/zaehler",`.
  - rot: `path = "/api/v1/lage"` in `src/public_api/`.
  - rot: `pub const X_PFAD: &str = "/api/spiegelung";`.
  - rot `veraltet`: Bestand enthält einen nicht registrierten Pfad.
  - rot `origin/alpha`: Bestand bekommt eine Zeile, die auf `origin/alpha` fehlt (Route dazu
    registriert).
  - grün: dasselbe ohne `refs/remotes/origin/alpha`, Ausgabe enthält `übersprungen`.
  - rot: Glossar unsortiert; rot: `segment` doppelt; rot: `deutsch` doppelt; grün: zweimal `-`;
    rot: `segment` mit Großbuchstabe.
  - `--bestand` gibt genau `/api/einsaetze/{id}` aus.

- [x] **Step 2: Selbsttest laufen lassen, rot sehen**
  Run: `scripts/check-api-routen.test.sh` → Expected: scheitert (Skript fehlt).

- [x] **Step 3: `check-api-routen.sh` schreiben.** Kopf wie `check-schreibweisen.sh` (Rot ist,
  Grenzen, Abhilfe, Aufruf; Verweis auf ADR-0085 und Design-Doc). Pfade sammeln mit
  `git -C "$ROOT" grep -h` (versionierte und neue Dateien wie dort):
  - `src/app.rs`: Zeilen `^\s*(\.route\()?"(/api[^"]*)"` — nur bis zur ersten Zeile
    `#[cfg(test)]`;
  - `src/public_api/**/*.rs`: `path = "(/api[^"]*)"`;
  - `src/**/*.rs`: `_PFAD: &str = "(/api[^"]*)"`.
  Segmente: an `/` teilen, `{…}` überspringen. Glossar ohne Kopfzeile, `#`-Zeilen als Kommentar
  erlaubt. Bestandsvergleich: `git show origin/alpha:scripts/api-routen-bestand.txt`; fehlt der
  Ref, Meldung `Bestandsvergleich übersprungen: origin/alpha fehlt`; fehlt nur die Datei auf
  dem Ref (erster PR), kein Vergleich.

- [x] **Step 4: Selbsttest grün**
  Run: `scripts/check-api-routen.test.sh` → Expected: `OK` je Fall, Exit 0.

- [x] **Step 5: Glossar füllen.** Alle heute nicht-deutschen Segmente (`api admin auth uhs
  material v1 status start etb adapter chat code proxy webauthn export finish position totp
  webhook plan providers tiles app-code discoverable download enroll import live matrix me oidc
  register web-push audit backup bulk callback codes config dev events fonts glyphs health
  jwks.json lan login logo logout marker openapi.json raster redeem reset shell sprite sprites
  style.json system test tile tilejson transport users`; Herkunft:
  `/tmp/claude-0/-workspace-lifeline-hub/be5e3b92-31f5-580a-8125-ea5475fe6381/scratchpad/segmente.tsv`,
  sonst neu ableiten), der Glossar-Kern aus dem Design-Doc (eine Zeile je Begriff; `etb`/`uhs`
  mit `ETB`/`UHS`) und die Segmente des ersten Pakets: `release-notes` Versionsstand, `read`
  gelesen, `password` Passwort, `set` festlegen, `sessions` Sitzungen, `end-others` andere
  beenden, `redeem` einlösen. Englische Segmente ohne festen deutschen Begriff: `-`.

- [x] **Step 6: Bestand erzeugen und Wächter auf dem Repo fahren**
  Run: `scripts/check-api-routen.sh --bestand > scripts/api-routen-bestand.txt && scripts/check-api-routen.sh`
  Expected: Exit 0; `wc -l` des Bestands in der Größenordnung 560–570; kein rein englischer Pfad
  (`/api/health`, `/api/shell`, `/api/auth/login`, `/api/v1/me`) im Bestand.

- [x] **Step 7: Commit** (`feat(scripts): Wächter für englische API-Routen mit Glossar und Bestand (LLH-1979)`)

### Task 2: Wächter ins Gate

**Files:**
- Modify: `scripts/check-all.sh` (`schritt_14`, Kopfkommentar der Schrittliste)
- Modify: `scripts/AGENTS.md` (Kette der Wächter, Abschnitt mit Schritt 14)
- Modify: `scripts/bereiche.sh` nur, falls dort Schritt 14 an Pfade gebunden ist, die
  `src/app.rs`/`src/public_api/**` nicht abdecken

- [x] **Step 1:** `schritt_14` ruft nach `check-schreibweisen` erst
  `check-api-routen.test.sh`, dann `check-api-routen.sh`; Titel „Keine Namen, die sich nur in der
  Groß-/Kleinschreibung unterscheiden (LFH-1053), API-Routen englisch (LLH-1979)“.
- [x] **Step 2: Verifizieren**
  Run: `scripts/check-all.test.sh && ./scripts/check-all.sh --nur 14`
  (Aufrufform von `--nur` im Skriptkopf nachsehen) → Expected: Schritt 14 grün.
- [x] **Step 3:** `bash scripts/bereiche.test.sh` grün; prüfen, dass `--geaendert` bei einer
  Änderung an `src/app.rs` Schritt 14 fährt (Bündel `schnell` läuft ohnehin im PR).
- [x] **Step 4: Commit** (`ci: Schritt 14 prüft englische API-Routen (LLH-1979)`)

### Task 3: Regel und ADR

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0085-api-routen-sind-englisch-nach-glossar.md`
- Modify: `AGENTS.md` (Abschnitt „Bezeichner-Sprache“)
- Modify: `docs/architektur/12-glossar.md` (ein Satz)

- [x] **Step 1: ADR schreiben** nach `VORLAGE.md`, `status: akzeptiert`, `datum: 2026-11-22`,
  `gilt_fuer`: `src/app.rs`, `src/public_api/**`, `scripts/api-routen-woerter.tsv`,
  `scripts/api-routen-bestand.txt`, `scripts/check-api-routen.sh`; `herleitung`: Design-Doc.
  Regeln:
  - MUST: Jedes feste Segment einer API-Route steht im Glossar `scripts/api-routen-woerter.tsv`;
    Form: Wurzel-`AGENTS.md`, „Bezeichner-Sprache“.
  - MUST: Ein deutscher Begriff hat im Glossar genau ein englisches Segment und umgekehrt.
  - MUST NOT: `scripts/api-routen-bestand.txt` bekommt keine neue Zeile.
  - MUST: Bis 1.0.0 wird ein Pfad ohne Alias umbenannt; Backend, Frontend und Hüllen im selben PR.
  - MUST: Ab 1.0.0 bleibt ein umbenannter Pfad 3 Major-Versionen lang als Alias erreichbar.
  - MUST: Bricht eine Umbenennung einen Pfad, den eine Hülle fest ruft, steigt `SHELL_CONTRACT`.
  Prüfung:
  ```sh
  verlange 'check-api-routen\.sh' scripts/check-all.sh
  verlange '^api	' scripts/api-routen-woerter.tsv
  ```
  Kontext/Konsequenzen je 2–5 Sätze, verweisen auf das Design-Doc.
- [x] **Step 2: `AGENTS.md`:** neuer Punkt „**API-Routen englisch** (LLH-1979, ADR-0085)“ nach
  „Fachbegriffe deutsch …“: jedes Segment englisch nach Glossar, auch Fachbegriffe; Abkürzungen
  wie `etb`, `uhs` bleiben; Kleinbuchstaben, `-` verbindet, Sammlungen Plural, Aktion als Verb
  am Ende; Pfadparameter-Namen und Code-Bezeichner bleiben deutsch nach der Regel oben; neue
  Request-/Response-Typen haben englische Wire-Felder (Rust-Feld = Wire-Feld), ein neues Feld in
  einem bestehenden Typ folgt dessen Sprache. „Grenzwerte bleiben“: `Routen` streichen, Verweis
  auf den neuen Punkt. Danach `wc -l AGENTS.md` < 200.
- [x] **Step 3: Kapitel 12:** ein Satz, dass das englische Glossar der API-Routen in
  `scripts/api-routen-woerter.tsv` steht (ADR-0085).
- [x] **Step 4: Verifizieren**
  Run: `scripts/check-architektur.test.sh && scripts/check-architektur.sh && scripts/check-adr-nummern.sh origin/alpha && scripts/adr-fuer.sh src/app.rs`
  Expected: grün; `adr-fuer.sh` nennt ADR-0085.
- [x] **Step 5: Commit** (`docs: ADR-0085 und Regel „API-Routen englisch“ (LLH-1979)`)

### Task 4: Paket Neuigkeiten (`versionsstand` → `release-notes`)

**Files:**
- Modify: `src/app.rs:282-286`, Doc-Kommentare in `src/routes/versionsstand.rs`,
  `src/versionsstand/mod.rs`
- Modify: `tests/versionsstand.rs`
- Modify: `frontend/src/api/versionsstand.ts`, `frontend/src/test/server.ts`,
  `frontend/src/neuigkeiten/*.test.tsx`
- Modify: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts` (erzeugt)
- Modify: `scripts/api-routen-bestand.txt` (zwei Zeilen weg), Doku-Treffer
  (`docs/architektur/0[56]-*.md`, `docs/betrieb/observability.md`, sofern dort genannt)

- [x] **Step 1:** In `tests/versionsstand.rs` die Pfade auf `/api/release-notes` und
  `/api/release-notes/read` umstellen.
  Run: `cargo test --test versionsstand` → Expected: FAIL (404).
- [x] **Step 2:** Routen in `src/app.rs` umbenennen, Doc-Kommentare nachziehen.
  Run: `cargo test --test versionsstand` → Expected: PASS.
- [x] **Step 3:** Bestand kürzen; `scripts/check-api-routen.sh` → Exit 0 (rot, solange die
  Zeilen noch drin stehen: veraltet).
- [x] **Step 4:** Frontend: Tests und MSW-Handler zuerst auf die neuen Pfade, `useVersionsstand`
  bzw. `api/versionsstand.ts` danach.
  Run: `mise exec -- pnpm -C frontend exec vitest run src/neuigkeiten src/api` → Expected: PASS.
- [x] **Step 5:** `scripts/check-typ-codegen.sh` (erzeugte Dateien tragen die Doc-Kommentare);
  geänderte Dateien mit committen.
- [x] **Step 6: Rest-Suche**
  Run: `git grep -n '/api/versionsstand' -- ':!openspec/changes/archive' ':!docs/superpowers'`
  Expected: keine Treffer (bis auf `openspec/specs/`, eingefroren).
- [x] **Step 7: Commit** (`refactor: /api/versionsstand heißt /api/release-notes (LLH-1979)`)

### Task 5: Paket Anmeldung (`auth`) mit Hüllen und Vertrag 2

**Files:**
- Modify: `src/app.rs:169-240`, Doc-Kommentare in `src/routes/auth.rs`, `src/routes/sitzung.rs`,
  `src/routes/benutzer.rs`, `src/auth/passwort_wechsel.rs`
- Modify: `src/routes/shell.rs:18` (`SHELL_CONTRACT = 2`), `tests/shell.rs`
- Modify: `tests/app_anmeldung.rs`, `tests/auth_audit.rs`, `tests/einmalpasswort.rs`,
  `tests/fehler_vertrag.rs`, `tests/passwort_aendern.rs`, `tests/sitzungen.rs`
- Modify: `frontend/src/api/auth.ts`, `frontend/src/api/sitzungen.ts`, zugehörige Tests
  (`client.sitzungsSperre.test.ts`, `auth/SitzungsListe.test.tsx`, `pages/LoginPage.test.tsx`,
  `pages/ProfilPage.test.tsx`), `frontend/src/test/server.ts`, `frontend/src/auth/AGENTS.md`
- Modify: `frontend/e2e/konto-anlegen.ts`, `frontend/e2e/doku-bilder/zugangsprotokoll.bilder.ts`
- Modify: `src-tauri/src/anmeldung.rs:63,224`
- Modify: `ios/LifelineKern/Sources/LifelineKern/Anmeldung.swift:172`,
  `ios/LifelineKern/Sources/LifelineKern/LifelineKern.swift:6` (`bekannteVertraege = [2]`),
  `ios/LifelineKern/Tests/LifelineKernTests/AnmeldungTests.swift:123`,
  `ios/LifelineKern/Tests/LifelineKernTests/VertragTests.swift`
- Modify: erzeugte Typen, Bestand (sechs Zeilen weg), Doku-Treffer

- [x] **Step 1: Rust-Tests zuerst** auf die neuen Pfade (Tabelle oben); in `tests/shell.rs`
  zusätzlich `assert_eq!(vertrag, 2)`.
  Run: `cargo test --test sitzungen --test passwort_aendern --test einmalpasswort --test app_anmeldung --test auth_audit --test fehler_vertrag --test shell`
  Expected: FAIL.
- [x] **Step 2:** Routen in `src/app.rs` umbenennen, `SHELL_CONTRACT = 2` (Doc-Kommentar: warum 2,
  Verweis LLH-1979), Doc-Kommentare nachziehen.
  Run: dieselben Tests → Expected: PASS.
- [x] **Step 3:** Bestand kürzen, `scripts/check-api-routen.sh` → Exit 0.
- [x] **Step 4: Frontend:** Tests/MSW zuerst, dann `api/auth.ts`, `api/sitzungen.ts`; auch
  `ME_PFAD`/`OHNE_SPERRE` in `api/client.ts` prüfen (betreffen nur `me`/`providers`, bleiben).
  Run: `mise exec -- pnpm -C frontend exec vitest run src/api src/auth src/pages` → PASS.
- [x] **Step 5: e2e-Helfer** `konto-anlegen.ts` und die Bilder-Spec umstellen (kein Lauf nötig,
  `tsc` deckt Tippfehler nicht ab: Rest-Suche in Step 8 fängt sie).
- [x] **Step 6: Desktop-Hülle:** Test `anmeldung.rs:224` auf `/api/auth/app-code/redeem`, dann
  das Skript in Zeile 63.
  Run: `cargo test -p lifeline-desktop anmeldung` (Paketname aus `src-tauri/Cargo.toml`)
  → Expected: PASS. Scheitert der Bau hier an fehlenden Systembibliotheken, Ergebnis notieren;
  die CI des iOS/Desktop-Bündels prüft.
- [x] **Step 7: iOS-Kern:** `AnmeldungTests` auf `'/api/auth/app-code/redeem'`,
  `VertragTests` auf `bekannteVertraege == [2]` und einen Fall „Server mit Vertrag 1 ist für
  `bekannt: [2]` zu alt“ (Richtung aus `Vertrag.swift` ablesen), dann `Anmeldung.swift` und
  `LifelineKern.swift`. Swift baut nur auf macOS (`ios/AGENTS.md`): hier nur Rest-Suche,
  gefahren im Bündel `ios` der CI.
- [x] **Step 8: Rest-Suche**
  Run: `git grep -nE "/api/auth/(sitzungen|passwort)|app-code/einloesen" -- ':!openspec' ':!docs/superpowers'`
  Expected: keine Treffer.
- [x] **Step 9:** `scripts/check-typ-codegen.sh`, Doku (`docs/architektur/05/06`,
  `docs/betrieb/*` mit Hüllen-Vertrag, `frontend/src/auth/AGENTS.md`) nachziehen.
- [x] **Step 10: Commit** (`refactor!: Anmelde-Routen englisch, Hüllen-Vertrag 2 (LLH-1979)`)

### Task 6: Gesamtprüfung

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` (einmal, im Hintergrund, wenn
  er nicht ins Zeitlimit passt) → Expected: alle gefahrenen Schritte grün. Ergebnis für den PR
  unter „Geprüft“ notieren.
- [x] **Step 2:** Plan-Kästchen abhaken, Plan und Umsetzung committen.
