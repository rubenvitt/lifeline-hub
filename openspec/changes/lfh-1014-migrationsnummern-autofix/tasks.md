# Tasks

## 1. Autofix-Skript (TDD, Selbsttest zuerst)

- [x] 1.1 `scripts/migrationen-autofix.test.sh` gegen echte Git-Repos mit lokalem Bare-Remote
  schreiben. Fälle: Kollision → Autofix-Commit mit Trailer auf dem Branch im Remote, Datei
  und `include_str!`-Verweis umbenannt, Folgeprüfung grün · keine Kollision → Exit 5, kein
  Commit · Bestandsmigration geändert → Exit 1, Remote unverändert · Branch im Remote
  inzwischen bewegt → Exit 4, Remote unverändert · Kopf-Branch `alpha` → Exit 3 · drei
  Autofix-Commits an der Spitze → Exit 3 · Kommentardatei nennt `alt → neu` und den
  Pull-Hinweis. Zuerst laufen lassen und rot sehen.
- [x] 1.2 `scripts/migrationen-autofix.sh` wie in design.md D2 umsetzen, bis 1.1 grün ist.
- [x] 1.3 Mutationsproben von Hand: Ziel-Branch-Sperre entfernen, Schleifenzähler auf 30
  setzen, Push mit `--force`; jeweils muss ein Fall aus 1.1 rot werden. Danach zurückdrehen.

## 2. Gate und Workflow

- [x] 2.1 `scripts/check-all.sh`: `migrationen-autofix.test.sh` in Schritt 10 (Bündel
  `schnell`) neben `check-migrationen.test.sh`; Reihenfolge in `scripts/AGENTS.md`
  nachziehen. Prüfen mit `./scripts/check-all.sh --nur schnell`.
- [x] 2.2 `.github/workflows/migrationen.yml`, Job `pr`: nach Exit 1 bei PRs aus diesem Repo
  App-Token erzeugen (eingeengt wie in D3), Skript vom Ziel-Branch aufrufen, bei Erfolg
  Kommentar posten und den alten Kopf mit „umnummeriert, neuer Commit folgt“ beschriften.
  Ohne `RELEASE_APP_ID` laut überspringen.
- [x] 2.3 Job `offene-prs`: dieselbe Reparatur je rotem PR (Kopf-Repo und Branch aus
  `gh pr list`), Zähler „umnummeriert“ in der Zusammenfassung; dazu die Ruleset-Abfrage aus
  D5 mit Warnung und Zusammenfassungszeile.
- [x] 2.4 Workflow per `actionlint` (falls vorhanden) bzw. YAML-Parse prüfen; Actions per SHA
  gepinnt wie im Bestand.

## 3. Doku

- [x] 3.1 `AGENTS.md`, Abschnitt „Backend — Migrationsvergabe“: Autofix auf dem PR-Branch
  (nie auf `alpha`), Pull-Hinweis, Ruleset-Pflicht und ihre Überwachung, Verweis auf dieses
  design.md. Unter 200 Zeilen bleiben.
- [x] 3.2 Kommentar im Kopf von `migrationen.yml` um den Autofix ergänzen.

## 4. Verifikation und Einführung

- [ ] 4.1 `./scripts/check-all.sh --nur schnell` grün, Ausgabe gelesen; dazu
  `scripts/check-fmt.sh`.
- [ ] 4.2 Probe am echten Repo vor dem Merge: Wegwerf-Branch auf diesem Branch mit einer
  Migration auf einer auf `alpha` vergebenen Nummer, PR gegen `alpha` öffnen. Weil `alpha`
  das Skript noch nicht trägt, greift die Fassung des PRs (wie beim Prüfskript). Sehen, dass
  Autofix-Commit, Kommentar und neue CI-Läufe kommen; PR schließen, Branch löschen.
- [ ] 4.3 Ruben bitten, `Migrationsnummern` ohne `integration_id` ins Ruleset 17017911
  aufzunehmen, und den Eintrag per `GET /repos/rubenvitt/lifeline-hub/rules/branches/alpha`
  nachweisen.
  Aufgabe 5.3 im Archiv von LFH-658 bleibt als historischer Stand unangetastet.
