# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/p31gqvlnmqub8pufumm5hz19 (LLH-1660)

## Why

Offene PRs gegen `alpha` bleiben trotz Auto-Merge liegen, bis jemand sie von Hand anfasst. Am
12.11.2026 standen fünf (#1282, #1283, #1285, #1286, #1287), aus drei wiederkehrenden Gründen:

- **Konflikte, die niemand sieht.** Jeder Merge auf `alpha` kann andere PRs konfliktbehaftet
  machen. Ein PR mit Konflikt startet keine CI und wartet still. Zweimal war es dieselbe Art
  Stelle: mehrere PRs hängen an dieselbe Tabelle an (ADR-Verzeichnis in Kapitel 9).
- **Jede Umnummerierung kostet einen vollen CI-Lauf.** Der Migrations-Autofix pusht einen
  Commit, der nur Dateien umbenennt; danach laufen Rust, Vitest und e2e erneut (e2e 45 bis 65
  Minuten je Anteil).
- **CI, die nie anlief.** An #1282 trug der Kopf-Commit 10 Stunden lang keinen CI-Lauf.

Eine Merge Queue gibt es für Repositories eines Benutzerkontos nicht
(`.github/workflows/migrationen.yml`, Kopf).

## What Changes

- **Stau-Wächter (neu):** Nach jedem Push auf einen Ziel-Branch, stündlich und von Hand bewertet
  ein Lauf jeden offenen PR. Bei einem Konflikt schreibt er einen Hinweis mit den betroffenen
  Dateien an den PR; der Kommentar weckt die Sitzung, die den PR betreut. Trägt der Kopf-Commit
  keinen CI-Lauf und gibt es keinen Konflikt, mergt die Release-App den Ziel-Branch in den
  PR-Branch, damit die CI anläuft.
- **Umnummerierung ohne schwere Suiten:** Besteht der Unterschied zum letzten grünen Commit nur
  aus Autofix-Commits, die Migrationen umbenennen, laufen Rust-, Frontend- und e2e-Suite leer
  durch. Die Schnellprüfungen und `Migrationsnummern` laufen weiter.
- **ADR-Verzeichnis ohne Tabelle:** Kapitel 9 führt die ADRs nicht mehr zeilenweise auf. Das
  Verzeichnis ist der Ordner `entscheidungen/` und die Website, die ihn schon aus den Dateien
  auflistet. Der Wächter „Kapitel 9 nennt die ADR nicht“ entfällt.
- **ADR-Nummern vor dem Merge geprüft (neu):** Ohne die Tabelle fiele eine doppelt vergebene
  ADR-Nummer erst auf `alpha` auf. Deshalb bekommt jeder offene PR den Commit-Status
  `ADR-Nummern`, neu bewertet, wenn sich der Ziel-Branch bewegt (wie `Migrationsnummern`).
- Nicht Teil: mehr e2e-Anteile, eine geplante Claude-Aufgabe als Rückfall (Entscheidung Ruben
  12.11.2026).

## Capabilities

### New Capabilities

- `merge-stau`: Erkennt offene PRs, die ohne Zutun nicht mergen können (Konflikt, fehlender
  CI-Lauf), macht das am PR sichtbar und stößt die CI an, wo das ohne Konfliktlösung geht.
- `adr-nummernvergabe`: Legt fest, dass eine neue ADR keine Nummer trägt, die der Ziel-Branch
  schon vergeben hat, und wann das geprüft wird.

### Modified Capabilities

- `migrationsvergabe`: Die Anforderung „Kollidierende PRs werden automatisch umnummeriert“
  verlangt nach dem Autofix-Commit nicht mehr die volle CI, sondern erlaubt, die schweren Suiten
  vom letzten grünen Commit zu übernehmen.

## Impact

- **Gate und CI:** neu `scripts/stau-waechter.sh`, `scripts/nur-umnummeriert.sh`,
  `scripts/check-adr-nummern.sh` samt Selbsttests und Schritten in `check-all.sh`; neu
  `.github/workflows/stau-waechter.yml`; geändert `.github/workflows/ci.yml` (Job `aenderungen`),
  `.github/workflows/migrationen.yml` (zweiter Status), `scripts/check-architektur.sh` samt
  Selbsttest.
- **Doku und Regeln:** `docs/architektur/09-architekturentscheidungen.md`, `docs/architektur/README.md`,
  `docs/architektur/AGENTS.md`, `scripts/AGENTS.md`, Wurzel-`AGENTS.md` (Migrationsvergabe,
  Verweis auf den Wächter).
- **Rechte:** Der Stau-Wächter nutzt die Release-App für den Push auf PR-Branches, mit denselben
  Grenzen wie der Migrations-Autofix. Ohne die App kommentiert er nur.
- **Handgriff für Ruben nach dem Merge:** `ADR-Nummern` im Ruleset 17017911 als Required Check
  eintragen (ohne `integration_id`). Bis dahin ist der Status nur eine Anzeige.
- Kein Anwendungscode, keine Migration, keine sichtbare Wirkung in der App.
