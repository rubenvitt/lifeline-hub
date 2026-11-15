---
id: ADR-0049
titel: Kein Pflicht-Check „Baut mit Ziel-Branch“; bei rotem alpha ist genau ein PR zuständig
status: akzeptiert
datum: 2026-11-15
ersetzt: ADR-0030
gilt_fuer:
  - .github/workflows/*.yml
  - scripts/stau-waechter.sh
  - scripts/ruleset-pruefen.sh
herleitung:
  - openspec/changes/archive/2026-11-15-ihwpo4ik-baut-mit-ziel-branch-entfernen/design.md
  - openspec/changes/archive/2026-11-12-g10eo9co-alpha-rot-schutz/design.md
  - Zunder LLH-1899 (Entscheidung Ruben, 15.11.2026)
---

# ADR-0049: Kein Pflicht-Check „Baut mit Ziel-Branch“; bei rotem alpha ist genau ein PR zuständig

## Regeln

- MUST NOT: Ein Workflow kompiliert nach einem Push auf einen Kanal-Branch die offenen PRs neu
  (kein Kompilierlauf je offenem PR). Pflicht-Checks: Liste in `scripts/ruleset-pruefen.sh`.
- MUST NOT: Code aus einem PR läuft in einem Lauf, dessen Ref ein Kanal-Branch ist.
- MUST: Aus ADR-0048 entfallen „Fertig heißt Auto-Merge an“ und die Zählung mit `Kompilieren`/
  `Melden`; Auto-Merge liest nur noch der Stau-Wächter („Grün, aber nicht gemergt“).
- MUST: Bruchstellen zweier einzeln grüner PRs, beim Kompilieren wie im Test, fängt der Befund
  „alpha rot“ des Stau-Wächters (`scripts/AGENTS.md`, „Stau-Wächter“).
- MUST: Bei rotem `alpha` bekommt höchstens ein offener PR den Auftrag zum Fix; er haftet eine
  Stunde an ihm, die übrigen warten.

## Prüfung

```sh
verbiete '"Baut mit Ziel-Branch[|]' scripts/ruleset-pruefen.sh
verbiete '^[^#]*Baut mit Ziel-Branch' '.github/workflows/*.yml'
test ! -e .github/workflows/ziel-branch-build.yml
test ! -e .github/workflows/ziel-branch-verteilen.yml
verlange 'workflows: \[CI\]' .github/workflows/stau-waechter.yml
verlange '^MARKE_ALPHA="stau-waechter-alpha"' scripts/stau-waechter.sh
```

## Kontext

ADR-0030 machte `Baut mit Ziel-Branch` zur Pflicht: Nach jedem Merge rechnete jeder fertige PR
rund 9 Minuten gegen den neuen Stand. Bei sieben PRs war das eine Stunde Kette, und vom 14. bis
15.11.2026 mergte kein PR, dessen grüner Check aus diesem Neuberechnen kam. Seit ADR-0048 landen
Testbrüche ohnehin auf `alpha`.

## Konsequenzen

Ein PR mergt, sobald Schnellprüfungen, Migrations- und ADR-Nummern grün sind. Kompilieren zwei
einzeln grüne PRs zusammen nicht, wird `alpha` rot, und genau ein Zuständiger baut den Fix. Lokal
prüft `check-all.sh --nur baut` nach einem Merge von `alpha` schnell, ob ein Stand übersetzt.
