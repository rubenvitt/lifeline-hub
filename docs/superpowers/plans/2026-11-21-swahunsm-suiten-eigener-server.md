# Schwere Suiten auf dem eigenen Server — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bei Push auf `alpha`/`beta`/`main` laufen Rust-Suite, Frontend-Anteile und e2e auf dem eigenen Server, PR-Läufe nie; Plätze melden ihre Runner ab.

**Architecture:** Eine Weiche (`select-runner.sh`) in einem neuen Job `runner` von `suiten.yml`; alle schweren Jobs lesen deren Ausgabe mit `ubuntu-latest` als Rückfall. `runner-loop.sh` löscht Runner-Registrierungen über die REST-API.

**Tech Stack:** GitHub Actions (YAML, wiederverwendbare Workflows), Bash 3.2-taugliche Skripte, Docker.

**Spec:** `docs/superpowers/specs/2026-11-21-swahunsm-suiten-eigener-server-design.md`

## Global Constraints

- Schalter bleibt die Repo-Variable `E2E_RUNNER`; leer heißt alles bei GitHub.
- Kein Runner-Label und kein `self-hosted` fest in `runs-on`; Rückfall immer `|| 'ubuntu-latest'`.
- Schritte mit `sudo`, apt oder `Swatinem/rust-cache` tragen `runner.environment == 'github-hosted'`.
- Das Token erscheint in keiner Kommandozeile (curl `--config -` über stdin).
- Job `schnell` bleibt in `ci.yml` und `pr.yml` wortgleich.
- Prosa deutsch, Bezeichner nach Wurzel-`AGENTS.md`, Bezeichner-Sprache (neue Funktionen englisch, z. B. `runner_delete`).

## Review Focus

- PR-Lauf mit dem Label `voll` → bleibt bei GitHub (Test in Task 1).
- Alte Weiche mit vier Argumenten aus dem Ziel-Branch, neuer Aufruf mit zwei → Abbruch, Rückfall GitHub (Test in Task 1: falsche Argumentzahl bricht ab).
- `DELETE` liefert 404, weil GitHub den Runner nach dem Job schon entfernt hat → kein Fehler, keine Pause (Test in Task 4).
- Aufräumen beim Start trifft nur Offline-Runner dieses Hosts und Platzes, nie einen anderen Platz oder einen laufenden (Test in Task 4).
- Image ohne WebKit auf dem Server → Rust-Suite scheitert mit Hinweis auf den Neubau statt mit Linkerfehler (Schritt in Task 3).

---

### Task 1: Weiche nur bei Push

**Files:**
- Modify: `scripts/runner/select-runner.sh`
- Test: `scripts/runner/select-runner.test.sh`

**Interfaces:**
- Produces: `select-runner.sh <ereignis> <label>` → gibt `<label>` oder `ubuntu-latest` aus; falsche Argumentzahl Exit 2.

- [ ] **Step 1:** Test umschreiben: `fall <beschreibung> <soll> <ereignis> <label>`. Fälle: Push mit Label → `lifeline-e2e`; `pull_request` mit Label → `ubuntu-latest` („PR nie, auch mit voll“); `pull_request_target`, `workflow_dispatch` → `ubuntu-latest`; Label leer, nur Leerzeichen → `ubuntu-latest`; Leerzeichen drumherum → Label; `a,b` und `["self-hosted"]` → `ubuntu-latest`; ein und vier Argumente → Abbruch.
- [ ] **Step 2:** `bash scripts/runner/select-runner.test.sh` → ROT (alte Signatur).
- [ ] **Step 3:** `select-runner.sh` auf zwei Argumente; `case`: nur `push` gibt das Label aus. Kopf: PRs nie auf den Server (LLH-2014, ADR-0075).
- [ ] **Step 4:** Test → alle `ok`.
- [ ] **Step 5:** Commit `feat(ci): Runner-Weiche schickt nur Push-Läufe auf den eigenen Server (LLH-2014)`.

### Task 2: Weiche in `suiten.yml`, e2e als Eingabe

**Files:**
- Modify: `.github/workflows/suiten.yml`, `.github/workflows/e2e.yml`, `.github/workflows/ci.yml` (Kopf), `.github/workflows/pr.yml` (Kopf)
- Test: `scripts/ci-stufen.test.sh`

**Interfaces:**
- Consumes: Task 1 (`select-runner.sh "$EREIGNIS" "$LABEL"`).
- Produces: Job `runner` in `suiten.yml` mit `outputs.runner`; `e2e.yml` mit `on.workflow_call.inputs.runner` (string, nicht Pflicht, Vorgabe `''`).

- [ ] **Step 1:** In `ci-stufen.test.sh`: Job-Liste `suiten.yml` = `runner rust frontend e2e ios berichte`; `runner` ohne `if`; `rust`, `frontend`: `runs-on: ${{ needs.runner.outputs.runner || 'ubuntu-latest' }}`; `e2e` reicht `runner: ${{ needs.runner.outputs.runner }}`; `e2e.yml` hat keinen Job `aenderungen`, `binaer`/`e2e` nehmen `inputs.runner || 'ubuntu-latest'`; `ios` und `berichte` bleiben `runs-on: ubuntu-latest`.
- [ ] **Step 2:** `bash scripts/ci-stufen.test.sh` → FEHL.
- [ ] **Step 3:** Job `aenderungen` aus `e2e.yml` als `runner` (Name „Suiten-Runner“) nach `suiten.yml` verschieben, Aufruf mit zwei Argumenten, `HEAD^1`-Lesart bei PR bleibt. `e2e.yml`: Eingabe `runner`, `binaer` ohne `needs`. Köpfe in `ci.yml`, `pr.yml`, `suiten.yml`, `e2e.yml` nachziehen. `checks: read` bleibt.
- [ ] **Step 4:** `bash scripts/ci-stufen.test.sh` → alle ok.
- [ ] **Step 5:** Commit `feat(ci): Runner-Wahl für alle Suiten in suiten.yml (LLH-2014)`.

### Task 3: Rust- und Frontend-Suite auf dem Server lauffähig

**Files:**
- Modify: `.github/workflows/suiten.yml` (Jobs `rust`, `frontend`), `.github/workflows/ci.yml` + `.github/workflows/pr.yml` (Job `schnell`, `save-if`), `scripts/runner/Dockerfile`
- Test: `scripts/runner/ci-schritte.test.sh`

**Interfaces:**
- Produces: `ci-schritte.test.sh [<datei> <jobs>]`; ohne Argumente prüft er `e2e.yml` (`binaer e2e`) und `suiten.yml` (`rust frontend`).

- [ ] **Step 1:** `ci-schritte.test.sh` auf mehrere Datei/Job-Paare erweitern; Mindestzahl gefundener Schritte je Paar (`suiten.yml`: mindestens 3). Gegenprobe: ohne die Bedingungen in `suiten.yml` ist er rot.
- [ ] **Step 2:** Test → ROT (`rust`: Plattenplatz, apt, rust-cache ohne Bedingung).
- [ ] **Step 3:** `rust`: die drei Schritte mit `if: runner.environment == 'github-hosted'`; neuer Schritt nur auf dem Server „Desktop-Pakete im Image“: `pkg-config --exists webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 javascriptcoregtk-4.1 librsvg-2.0 ayatana-appindicator3-0.1 || { echo "::error::…Image neu bauen (scripts/runner/README.md)"; exit 1; }`. Dockerfile: dieselben `-dev`-Pakete wie in `suiten.yml` im ersten `apt-get install`. `schnell` (beide Dateien wortgleich): `save-if: ${{ github.event_name == 'push' && vars.E2E_RUNNER != '' }}` mit Kommentar.
- [ ] **Step 4:** `bash scripts/runner/ci-schritte.test.sh` und `bash scripts/ci-stufen.test.sh` → grün.
- [ ] **Step 5:** Commit `feat(ci): Rust- und Frontend-Suite laufen auf dem eigenen Server (LLH-2014)`.

### Task 4: Runner abmelden

**Files:**
- Modify: `scripts/runner/runner-loop.sh`
- Test: `scripts/runner/runner-loop.test.sh`

**Interfaces:**
- Produces: `jit_holen` setzt zusätzlich `runner_id`; `runner_delete <id>` (DELETE, 404 ok); `stale_runners_delete` beim Start.

- [ ] **Step 1:** curl-Fälschung nach URL verzweigen: `generate-jitconfig` → Warteschlange wie bisher; `--request DELETE` → mitschreiben, Exit aus `FAKE_DELETE_EXIT`; GET `actions/runners?per_page=100` → Inhalt von `$WERK/liste`. Neue Fälle: nach einem Job `DELETE …/actions/runners/7`; beim Stopp per SIGTERM ebenso; 404 beim DELETE (curl Exit 22) → keine Pause; beim Start werden aus einer Liste mit `srv-p1-1 offline`, `srv-p1-2 online`, `srv-p2-3 offline`, `anders-p1-4 offline` (Host `srv`) nur ID von `srv-p1-1` gelöscht; Token nie in `curl.args`.
- [ ] **Step 2:** `bash scripts/runner/runner-loop.test.sh` → ROT.
- [ ] **Step 3:** Umsetzen. Gemeinsamer Helfer `github_api <methode> <pfad> [daten]` mit Token über stdin. JSON ohne `jq`: Liste mit `tr`/`sed` in Objekte je Runner zerlegen, `id`, `name`, `status` je Objekt lesen. Host-Name in der Fälschung über `hostname`-Fälschung (`srv`).
- [ ] **Step 4:** Test → alle ok.
- [ ] **Step 5:** Commit `feat(runner): Plätze melden ihre Runner bei GitHub ab (LLH-2014)`.

### Task 5: ADR-0075, README, Gate

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0075-schwere-suiten-laufen-bei-push-auf-dem-eigenen-server.md`
- Modify: `docs/architektur/entscheidungen/ADR-0025-…md` (`status: ersetzt`, `ersetzt_durch: ADR-0075`), `scripts/runner/README.md`, Verweise auf ADR-0025 in Workflows und Skripten
- Test: `scripts/check-architektur.sh`

- [ ] **Step 1:** ADR-0075 nach `VORLAGE.md`, unter 80 Zeilen, `ersetzt: ADR-0025`, `gilt_fuer` wie ADR-0025 plus `.github/workflows/suiten.yml`. Regeln: Isolation unverändert übernommen; Wahl allein in Job `runner` von `suiten.yml`; nur `push` auf den Server; Jobs `rust`, `frontend`, `binaer`, `e2e` mit Rückfall; Rückfall-Schritte gehostet; Plätze melden Runner ab. Prüfung mit `verlange`/`verbiete`.
- [ ] **Step 2:** README: Zweck, „Nach dem Merge“ (Image neu bauen, Plätze neu starten), Plätze/Speicher, Abmelden.
- [ ] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 4:** Commit `docs(ci): ADR-0075 ersetzt ADR-0025, README zum eigenen Server (LLH-2014)`.
