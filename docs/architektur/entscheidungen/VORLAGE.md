---
id: ADR-0000
titel: Entscheidung in einem Satz, als Aussage
status: vorgeschlagen
datum: JJJJ-MM-TT
gilt_fuer:
  - src/modul/**
herleitung:
  - openspec/changes/archive/<datum>-<name>/design.md
---

# ADR-0000: Entscheidung in einem Satz, als Aussage

## Regeln

- MUST …
- MUST NOT …
- SHOULD …

## Prüfung

```sh
# Exit 0, solange die Regeln gelten (Hilfen und Grenzen: docs/architektur/AGENTS.md).
verbiete 'verbotenes Muster' 'src/**/*.rs'
verlange '^pub mod modul' 'src/lib.rs'
```

## Kontext

Zwei bis fünf Sätze: welches Problem, welche Kräfte.

## Konsequenzen

Zwei bis fünf Sätze: was dadurch leichter, was schwerer wird.
