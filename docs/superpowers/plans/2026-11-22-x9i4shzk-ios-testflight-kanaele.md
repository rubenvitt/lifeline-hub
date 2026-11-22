# iOS-App: jeder Kanal zu TestFlight, Verteilung je Kanal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder freigegebene Tag geht zu TestFlight; ein CI-Schritt hängt den Build je Kanal an „Intern“ bzw. „Intern“+„Extern“.

**Architecture:** `testflight.sh` nimmt Alpha an und meldet die Build-Nummer; neues Node-Skript
`testflight-verteilen.mjs` spricht die App-Store-Connect-API; `ios.yml` bekommt einen Ubuntu-Job
`verteilen`, `artefakte.yml` startet `ios.yml` für jeden Kanal. Regel in ADR-0078.

**Tech Stack:** Bash, Node (aus `mise.toml`, `node:test`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-22-x9i4shzk-ios-testflight-kanaele-design.md`

Ausführung: `executing-plans` im Main-Loop (vier kleine, aufeinander aufbauende Aufgaben).

## Global Constraints

- Gruppennamen fest: `Intern` (intern), `Extern` (extern, ohne öffentlichen Link).
- `alpha` → `[Intern]`; `beta`, `main` → `[Intern, Extern]`; andere Vorabkanäle abgewiesen.
- „Was testen“ höchstens 4000 Zeichen, erste Zeile `Lifeline <volle Version>`.
- Bundle-ID `dev.rubeen.lifeline.ios`; Secrets `APP_STORE_CONNECT_KEY_ID`, `_ISSUER_ID`, `_KEY_P8`.
- Kein Schritt hält Release oder Deployment auf; Schlüssel nie im Log, nach dem Lauf gelöscht.

## Review Focus

- Gruppe fehlt → wird **vor** dem Warten angelegt (Test in Task 2).
- Build bleibt `PROCESSING` über die Wartezeit → klarer Fehler mit Zustand (Task 2).
- Einreichung läuft schon (zweiter Lauf desselben Builds) → keine zweite Einreichung (Task 2).
- Release-Notizen fehlen → „Was testen“ nur mit Versionszeile (Task 2).
- Alpha-Tag erreicht nie eine externe Gruppe (Task 2, `gruppenFuer`).

---

### Task 1: `testflight.sh` nimmt Alpha an und meldet die Build-Nummer

**Files:** Modify `scripts/ios/testflight.sh`, `scripts/ios/testflight.test.sh`

**Interfaces:** Produces: bei gesetztem `GITHUB_OUTPUT` die Zeile `build=<JJJJMMTTHHMM>` darin.

- [x] Test: Fall „Alpha“ erwartet Exit 0 und einen Upload (`-exportArchive`); Fall `-rc.1` bleibt abgewiesen; mit `GITHUB_OUTPUT=<datei>` steht `build=` mit 12 Ziffern darin.
- [x] Lauf `scripts/ios/testflight.test.sh` → FEHL bei Alpha und `build=`.
- [x] Muster `^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$`, Kopfkommentar und Meldung anpassen; Build-Nummer aus `Version.xcconfig` (`CURRENT_PROJECT_VERSION`) nach `$GITHUB_OUTPUT`.
- [x] Lauf grün.
- [x] Commit.

### Task 2: `testflight-verteilen.mjs`

**Files:** Create `scripts/ios/testflight-verteilen.mjs`, `scripts/ios/testflight-verteilen.test.mjs`; Modify `scripts/check-all.sh` (Schritt 8), `scripts/AGENTS.md` (Testliste)

**Interfaces:** Produces:
- `token({ keyId, issuerId, privateKey, now? }) → string`
- `client({ keyId, issuerId, privateKey, fetch? }) → request(method, path, body?)` (wirft mit `status`)
- `kanal(tag) → 'alpha'|'beta'|'main'` (wirft bei anderem Tag)
- `gruppenFuer(kanal) → string[]`
- `wasTesten({ version, notizen }) → string` (Klartext, ≤ 4000)
- `verteilen({ request, bundleId, buildNummer, gruppen, wasTesten, warteMs?, pruefMs?, schlafe?, log? }) → build`
- CLI: Umgebung `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `ASC_KEY_PATH`, `TAG`, `BUILD_NUMMER`, `NOTIZEN_DATEI` (optional), `WARTE_MINUTEN` (Vorgabe 45).

- [x] Tests (nachgebaute API wie in Vault Cockpit): JWT; Client-Fehler nennt Status und Apples Text; `kanal`/`gruppenFuer` (Alpha nur `Intern`, `rc` wirft); `wasTesten` (Versionszeile, Markdown-Links/`**`/`#` entfernt, gekürzt auf 4000, ohne Notizen nur Versionszeile); fehlende Gruppen angelegt **vor** dem ersten Build-Abruf (`isInternalGroup` true/false, `hasAccessToAllBuilds: false` für intern); Warten bis `VALID`; Zeitüberschreitung nennt Zustand; `FAILED` wirft; Zuordnung je Gruppe; Einreichung nur bei externer Gruppe und nur ohne laufende.
- [x] `mise exec -- node --test scripts/ios/testflight-verteilen.test.mjs` → FEHL.
- [x] Implementieren (Port von `vault-cockpit/ios/scripts/testflight-distribute.js`, deutsch benannt).
- [x] Tests grün; in `check-all.sh` Schritt 8 und `scripts/AGENTS.md` eintragen.
- [x] Commit.

### Task 3: Workflows

**Files:** Modify `.github/workflows/ios.yml`, `.github/workflows/artefakte.yml`

**Interfaces:** Consumes `build`-Ausgabe (Task 1), CLI (Task 2).

- [x] `ios.yml`: Job `testflight` → `outputs.build`; Job `verteilen` (`needs: testflight`, `ubuntu-latest`, `timeout-minutes: 60`, `permissions: contents: read`): Tag-Muster prüfen, Checkout des Tags (das Skript gehört zum Stand), mise-action, Notizen per `gh release view "$TAG" --json body -q .body > datei || true`, Schlüssel 600 in `$RUNNER_TEMP`, Skript, Schlüssel löschen (`if: always()`). Dispatch-Beschreibung ohne „nie Alpha“.
- [x] `artefakte.yml` Job `ios`: Bedingung ohne Kanal-Einschränkung, Kommentare und Kopf (Zeile 8–9) nachziehen.
- [x] `actionlint` falls vorhanden, sonst YAML-Parse prüfen.
- [x] Commit.

### Task 4: Regel und Doku

**Files:** Create `docs/architektur/entscheidungen/ADR-0078-…md`; Modify `docs/betrieb/ios-app.md`, `docs/anwender/kapitel/einsatztagebuch.md`, `docs/anwender/kapitel/einsatz-oberflaeche.md`

- [x] ADR-0078 nach `VORLAGE.md` mit Prüfung (`verlange` Alpha im Muster von `testflight.sh`, `verbiete` Kanal-Einschränkung im Job `ios`).
- [x] Betriebsdoku: „Welche Stände kommen an“, Gruppen, Verteilung, Übergaben (Tester einladen, Testinformationen), Release-Ablauf.
- [x] Haptik in den beiden Anwenderkapiteln, nur Ist-Stand (iPhone-App, Schalter „Haptik“).
- [x] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [x] Commit.
