---
id: ADR-0047
titel: Ein PR prüft leicht, die Suiten laufen auf den Kanal-Branches
status: akzeptiert
datum: 2026-11-14
ersetzt: ADR-0026
gilt_fuer:
  - .github/workflows/ci.yml
  - .github/workflows/e2e.yml
  - scripts/ci-stufen.test.sh
herleitung:
  - openspec/changes/p4avye3q-pr-checks-leicht/design.md
  - Zunder LLH-1889 (Erweiterung vom 14.11.2026, Weg entschieden von Ruben)
---

# ADR-0047: Ein PR prüft leicht, die Suiten laufen auf den Kanal-Branches

## Regeln

- MUST: Pflicht an einem PR sind nur `Schnellprüfungen`, `Migrationsnummern`,
  `Baut mit Ziel-Branch` und `ADR-Nummern`. Rust-, Frontend- und e2e-Suite sind keine Pflicht.
- MUST: Die Jobs `rust`, `frontend` und `e2e` in `ci.yml` laufen nur bei einem Push auf einen
  Kanal-Branch oder an einem PR mit dem Label `voll`; die Bedingung steht am Job.
- MUST NOT: Ein Label-Ereignis überspringt die Schnellprüfungen.
- MUST: `e2e.yml` startet nur per `workflow_call` aus `ci.yml`; Runner-Wahl und Fork-Sperre
  bleiben dort (ADR-0025).
- MUST: Auf einem Kanal-Branch bricht ein neuer Push die Testjobs des laufenden Laufs ab, über
  `concurrency` auf Job-Ebene je Branch und Job; auf Workflow-Ebene hat ein Push-Lauf eine eigene
  Gruppe je Lauf.
- MUST: Der Job `release` hat eine eigene Gruppe je Branch ohne Abbruch und wartet per `needs`
  auf alle Testjobs; ein abgebrochener oder roter Testjob lässt ihn entfallen.
- MUST NOT: Der Release hängt an einem `workflow_run`.
- MUST: „Fertig“ heißt Auto-Merge an; kein Label macht einen PR fertig
  (`scripts/ziel-branch-build.sh`).
- MUST NOT: Die CI wählt Suiten nach geänderten Bereichen aus. Die Auswahl bleibt lokal
  (`check-all.sh --geaendert`, `scripts/bereiche.sh`).
- SHOULD: Vor dem PR läuft lokal `./scripts/check-all.sh --geaendert --ohne-e2e`; eine riskante
  Änderung bekommt das Label `voll`.

## Prüfung

```sh
# e2e.yml hat keinen eigenen PR-Auslöser mehr, ci.yml ruft ihn auf.
verbiete '^  pull_request:' .github/workflows/e2e.yml
verlange '^  workflow_call:' .github/workflows/e2e.yml
verlange 'uses: \./\.github/workflows/e2e\.yml' .github/workflows/ci.yml
# „Fertig“ liest ci.yml nicht; keine Auswahl nach Bereichen, kein Release per workflow_run.
verbiete '^[^#]*auto_merge' .github/workflows/ci.yml
verbiete 'ci-auswahl|nur-umnummeriert' .github/workflows/ci.yml .github/workflows/e2e.yml
verbiete '^  workflow_run:' .github/workflows/ci.yml .github/workflows/release.yml
# Der Job `release` bricht nie ab.
awk '/^  release:/ { j = 1; next } /^  [A-Za-z0-9_-]+:/ { j = 0 }
  j && /cancel-in-progress: false/ { g = 1 } END { exit !g }' .github/workflows/ci.yml
# Form der Bedingungen und Gruppen im Detail: scripts/ci-stufen.test.sh.
```

## Kontext

Am 14.11.2026 trug ein PR 42 Check-Einträge, und jeder fertige PR fuhr rund eine Stunde Suiten.
Zehn PRs hingen, weil jeder Merge auf `alpha` die Prüfungen aller fertigen PRs neu anstieß, und
ein zeitabhängiger Test machte jeden offenen PR rot (LLH-1889). Die zweite Stufe aus ADR-0026
verschob die e2e-Suite nur ans Ende des PRs, sie sparte sie nicht. Auf einem Kanal-Branch durfte
der Lauf nicht abbrechen, weil der Release am selben Lauf hängt.

## Konsequenzen

Ein PR kostet wenige Minuten. Brüche, die erst ein Test zeigt, landen auf `alpha`; dort fängt sie
der alpha-rot-Ablauf des Stau-Wächters (ADR-0030), und ein abgebrochener Lauf zählt dabei nicht.
Abgebrochene Läufe zeigen auf `alpha` ein rotes Kreuz; grün heißt: der jüngste vollständige Lauf
ist grün. Ein PR mit `voll` und roter Suite bleibt mergebar. Ob Concurrency auf Job-Ebene den
Aufruf von `e2e.yml` wie erwartet abbricht, zeigt erst der Betrieb (design.md, Risiken).
