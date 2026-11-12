---
id: ADR-0030
titel: Ein fertiger PR baut mit dem aktuellen Ziel-Branch, und bei rotem alpha ist genau ein PR zuständig
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - .github/workflows/ziel-branch-build.yml
  - .github/workflows/stau-waechter.yml
  - scripts/ziel-branch-build.sh
  - scripts/stau-waechter.sh
herleitung:
  - openspec/changes/archive/2026-11-12-g10eo9co-alpha-rot-schutz/design.md
  - Zunder LLH-1849 (Weg abgestimmt und Change freigegeben von Ruben am 12.11.2026)
---

# ADR-0030: Ein fertiger PR baut mit dem aktuellen Ziel-Branch, und bei rotem alpha ist genau ein PR zuständig

## Regeln

- MUST: Es gelten die Regeln in `scripts/AGENTS.md`, „Baut mit Ziel-Branch“ und „Stau-Wächter“
  (Befund „alpha rot“).
- MUST: Der Check `Baut mit Ziel-Branch` entsteht über die Checks-API, nie als Job-Name.
- MUST NOT: PR-Code läuft in einem Lauf, dessen Ref ein Kanal-Branch ist; nach einem Push rechnet
  je fertigem PR ein eigener Lauf auf dessen Branch (`workflow_dispatch`).
- MUST NOT: Der Job `kompilieren` hat Schreibrecht, Secret, gespeicherten Zugang oder speichernden
  Cache.
- MUST: Bei rotem `alpha` bekommt höchstens ein offener PR den Auftrag zum Fix; er haftet eine
  Stunde an ihm, die übrigen warten.

## Prüfung

```sh
verbiete '^    name: Baut mit Ziel-Branch' .github/workflows/ziel-branch-build.yml
verlange '^NAME="Baut mit Ziel-Branch"' scripts/ziel-branch-build.sh
verlange '^  workflow_dispatch:' .github/workflows/ziel-branch-build.yml
verlange 'github\.event_name != .push. && needs\.vorbereiten' .github/workflows/ziel-branch-build.yml
verlange 'contains\(fromJSON\(.\["main", "beta", "alpha"\].\), github\.ref_name\)' .github/workflows/ziel-branch-build.yml
verbiete 'uses: actions/cache(/save)?@' .github/workflows/ziel-branch-build.yml
verlange 'workflows: \[CI\]' .github/workflows/stau-waechter.yml
verlange '^MARKE_ALPHA="stau-waechter-alpha"' scripts/stau-waechter.sh
```

## Kontext

Die CI eines PRs prüft den Ziel-Branch beim letzten Push. Am 12.11.2026 waren #1319 und #1315
einzeln grün und brachen `alpha` zusammen; danach bauten vier Sitzungen denselben Fix, und ihre
Varianten kollidierten in drei weiteren PRs. Eine Merge Queue gibt es für Repositories eines
Benutzerkontos nicht, „up to date“ erzwingen hieße die volle CI je Merge und PR.

## Konsequenzen

Ein Bruch, der sich beim Kompilieren zeigt, mergt nicht mehr, bis auf ein kurzes Fenster zwischen
Push und Verteilen; je Merge auf einen Kanal-Branch kostet jeder fertige PR einen eigenen
Kompilierlauf von wenigen Minuten. Der Push-Lauf führt keinen PR-Code aus, damit kein Cache im
Bereich von `alpha` entsteht, den der Release-Build liest. Brüche, die erst ein Test zeigt,
landen weiter auf `alpha`; dann baut genau ein Zuständiger den Fix, und der Wächter zieht die roten
PRs danach nach. Der Check wird erst Pflicht, wenn Ruben ihn im Ruleset einträgt.
