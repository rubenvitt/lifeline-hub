---
id: ADR-0091
titel: Testjobs auf Kanal-Branches laufen zu Ende, statt bei jedem Push abzubrechen
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - .github/workflows/suiten.yml
  - scripts/ci-stufen.test.sh
  - scripts/AGENTS.md
herleitung:
  - docs/superpowers/specs/2026-11-22-xmwf58ws-suiten-laufen-zu-ende-design.md
  - Zunder LLH-2035 (Weg abgestimmt mit Ruben am 22.11.2026)
---

# ADR-0091: Testjobs auf Kanal-Branches laufen zu Ende, statt bei jedem Push abzubrechen

## Regeln

- MUST: Aus ADR-0048 entfällt „Auf einem Kanal-Branch bricht ein neuer Push die Testjobs des
  laufenden Laufs ab“; die übrigen Regeln von ADR-0048 gelten weiter.
- MUST: Jeder Testjob in `suiten.yml` (Stand 23.11.2026: `rust`, `frontend` je Anteil, `e2e`,
  `ios`, `android`, `berichte`) hat Concurrency je Branch und Job mit `cancel-in-progress: false`:
  ein gestarteter Job läuft zu Ende, je Gruppe wartet höchstens ein Lauf, ein neuer Push ersetzt
  nur den wartenden.
- MUST NOT: `cancel-in-progress: true` in `suiten.yml`.
- MUST: Der Release bleibt wie in ADR-0048 (eigene Gruppe ohne Abbruch, `needs`); ein überholter
  Lauf released nicht (`scripts/release-ruhefenster.sh`).
- SHOULD: Neu gestartet wird nur ein Job des jüngsten Laufs eines Kanal-Branches
  (`scripts/AGENTS.md`, „Leichte PR-Prüfung“).

## Prüfung

```sh
verbiete '^[^#]*cancel-in-progress:[[:space:]]*true' .github/workflows/suiten.yml
# Jeder Concurrency-Block eines Jobs trägt `cancel-in-progress: false`.
test "$(grep -cE '^      cancel-in-progress: false$' .github/workflows/suiten.yml)" \
  -eq "$(grep -cE '^    concurrency:$' .github/workflows/suiten.yml)"
# Form der Gruppen je Job: scripts/ci-stufen.test.sh.
```

## Kontext

Die Rust-Suite braucht auf `ubuntu-latest` rund 68 Minuten. Mit Abbruch bei jedem Push kam bei
mehreren Merges pro Stunde kein Lauf mehr durch: am 22.11.2026 endeten 24 von 25 Push-Läufen auf
`alpha` als abgebrochen. Ohne Ergebnis sieht der Stau-Wächter kein Rot, und es entsteht kein
Release.

## Konsequenzen

Auch in Merge-Schüben entsteht regelmäßig ein vollständiges Ergebnis; übersprungene
Zwischenstände deckt der nächste Lauf mit ab. Das Ergebnis des neuesten Commits kommt dafür
später, im schlimmsten Fall nach dem laufenden und einem eigenen Durchlauf, und die Runnerzeit
steigt um die nicht mehr abgebrochenen Jobs. Die Rust-Suite zu beschleunigen bleibt eine eigene
Aufgabe.
