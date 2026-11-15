---
id: ADR-0048
titel: Ein Workflow je Ereignis, ein PR prüft leicht, und das Ruleset wird geprüft
status: akzeptiert
datum: 2026-11-15
ersetzt: ADR-0047
gilt_fuer:
  - .github/workflows/*.yml
  - scripts/ci-stufen.test.sh
  - scripts/ruleset-pruefen.sh
herleitung:
  - openspec/changes/archive/2026-11-15-czjhc4qq-ci-pr-schlank/design.md
  - openspec/changes/archive/2026-11-14-p4avye3q-pr-checks-leicht/design.md
  - Zunder LLH-1894 mit LLH-1895 und LLH-1896 (Weg abgestimmt mit Ruben am 15.11.2026)
---

# ADR-0048: Ein Workflow je Ereignis, ein PR prüft leicht, und das Ruleset wird geprüft

## Regeln

- MUST: Pflicht an einem PR sind genau die Checks in der Liste von `scripts/ruleset-pruefen.sh`;
  Rust-, Frontend- und e2e-Suite sind keine Pflicht.
- MUST: `ruleset.yml` prüft das Ruleset von `alpha` gegen diese Liste und endet bei Abweichung rot.
  Ein Commit-Status steht dort ohne Quelle.
- MUST: Ein Workflow hört entweder auf `pull_request` oder auf `push`, nie auf beides. Was nur bei
  einem Push auf einen Kanal-Branch läuft, steht in einem Workflow ohne PR-Auslöser.
- MUST: Rust-, Frontend- und e2e-Suite stehen in `suiten.yml`. `ci.yml` ruft ihn bei jedem Push,
  `pr.yml` nur mit dem Label `voll`; die Bedingung steht am Aufruf.
- MUST: Ein Pflicht-Check-Job steht nicht in einem aufgerufenen Workflow. `schnell` steht in
  `ci.yml` und `pr.yml` wortgleich (`scripts/ci-stufen.test.sh`).
- MUST NOT: Ein Label-Ereignis überspringt die Schnellprüfungen.
- MUST: `e2e.yml` startet nur per `workflow_call` aus `suiten.yml`; Runner-Wahl und Fork-Sperre
  bleiben dort (ADR-0025).
- MUST: Auf einem Kanal-Branch bricht ein neuer Push die Testjobs des laufenden Laufs ab, über
  `concurrency` auf Job-Ebene je Branch und Job; `ci.yml` hat eine eigene Gruppe je Lauf.
- MUST: Der Job `release` hat eine eigene Gruppe je Branch ohne Abbruch und wartet per `needs`
  auf `schnell` und `suiten`; ein abgebrochener oder roter Testjob lässt ihn entfallen.
- MUST NOT: Der Release hängt an einem `workflow_run`.
- MUST: „Fertig“ heißt Auto-Merge an; kein Label macht einen PR fertig.
- MUST NOT: Die CI wählt Suiten nach geänderten Bereichen aus. SHOULD: Vor dem PR läuft lokal
  `./scripts/check-all.sh --geaendert --ohne-e2e`; eine riskante Änderung bekommt `voll`.

## Prüfung

```sh
verbiete '^  pull_request:' .github/workflows/ci.yml .github/workflows/suiten.yml .github/workflows/e2e.yml
verbiete '^  push:' .github/workflows/pr.yml .github/workflows/suiten.yml .github/workflows/e2e.yml
verlange '^  workflow_call:' .github/workflows/suiten.yml .github/workflows/e2e.yml
verlange 'uses: \./\.github/workflows/e2e\.yml' .github/workflows/suiten.yml
verlange 'uses: \./\.github/workflows/suiten\.yml' .github/workflows/ci.yml .github/workflows/pr.yml
# „Fertig“ liest die CI nicht; keine Auswahl nach Bereichen, kein Release per workflow_run.
verbiete '^[^#]*auto_merge' .github/workflows/ci.yml .github/workflows/pr.yml
verbiete 'ci-auswahl|nur-umnummeriert' .github/workflows/ci.yml .github/workflows/pr.yml .github/workflows/suiten.yml
verbiete '^  workflow_run:' .github/workflows/ci.yml .github/workflows/release.yml
# Kein Workflow hört auf PR und Push zugleich.
for f in .github/workflows/*.yml; do grep -q '^  pull_request:' "$f" && grep -q '^  push:' "$f" && exit 1; done
# Das Ruleset wird gegen die Liste geprüft.
verlange 'scripts/ruleset-pruefen\.sh' .github/workflows/ruleset.yml
# Der Job `release` bricht nie ab.
awk '/^  release:/ { j = 1; next } /^  [A-Za-z0-9_-]+:/ { j = 0 }
  j && /cancel-in-progress: false/ { g = 1 } END { exit !g }' .github/workflows/ci.yml
# Form der Bedingungen, Gruppen und der Gleichheit von `schnell`: scripts/ci-stufen.test.sh.
```

## Kontext

ADR-0047 machte den PR leicht, ließ aber Push-Jobs und Suiten als übersprungene Einträge an jedem
PR stehen (neun an einem nicht fertigen PR ohne `voll`), weil ein Job mit falschem `if`
trotzdem erscheint.
Am 14.11.2026 bekam `Migrationsnummern` im Ruleset beim Austragen der Suiten eine Quelle; der
Status zählte nicht mehr, und alle grünen PRs hingen über Nacht, ohne dass ein Check rot war.

## Konsequenzen

Ein nicht fertiger PR ohne `voll` zeigt drei übersprungene Einträge: den Aufruf der Suiten und
`Kompilieren`/`Melden` des Pflicht-Checks (ADR-0030). Auf `alpha` heißen die Suiten-Jobs `Suiten / …`. `schnell` steht doppelt und wird per
Formtest gleich gehalten. Ein Fehler im Ruleset macht binnen Minuten nach dem nächsten Push auf
`alpha`, sonst binnen sechs Stunden, einen Lauf rot, und der Stau-Wächter nennt ihn am hängenden
PR.
