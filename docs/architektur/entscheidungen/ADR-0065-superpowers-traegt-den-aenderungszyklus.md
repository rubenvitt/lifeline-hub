---
id: ADR-0065
titel: Superpowers trägt den Änderungszyklus, OpenSpec ist eingefrorenes Archiv
status: akzeptiert
datum: 2026-11-18
ersetzt: ADR-0013
gilt_fuer:
  - openspec/**
  - docs/superpowers/**
  - .claude/settings.json
  - scripts/check-openspec-eingefroren.sh
herleitung:
  - docs/superpowers/specs/2026-11-18-superpowers-statt-openspec-design.md
---

# ADR-0065: Superpowers trägt den Änderungszyklus, OpenSpec ist eingefrorenes Archiv

## Regeln

- MUST: Eine Änderung auf der Route `entwurf` entsteht als Design-Doc unter
  `docs/superpowers/specs/` und Plan unter `docs/superpowers/plans/`, mit Freigabe-Halt nach dem
  Design-Doc; Ablauf: Wurzel-`AGENTS.md`, „Planung und Ausführung — Superpowers“.
- MUST NOT: nichts Neues unter `openspec/`; Archiv und Fähigkeits-Specs bleiben lesbar und
  unverändert (Wächter: Schritt 13 von `scripts/check-all.sh`).
- MUST: Superpowers ist als Plugin in `.claude/settings.json` eingetragen; seine Skills werden
  nicht ins Repo kopiert.
- MUST: Neue verbindliche Regeln stehen in der Bereichs-`AGENTS.md` oder einer ADR, die
  Begründung im Design-Doc.
- MUST: Eine Entscheidung (E1) zieht eine ADR mit, die auf ihr Design-Doc verweist; Pflicht und
  Form: `docs/architektur/AGENTS.md`, „Mitänderungsregel“ und „Entscheidungen (ADRs)“.

## Prüfung

```sh
test ! -e openspec/config.yaml
test -x scripts/check-openspec-eingefroren.sh
verlange 'check-openspec-eingefroren\.sh' scripts/check-all.sh
verlange 'superpowers@superpowers-marketplace' .claude/settings.json
verbiete '/opsx:' AGENTS.md '.claude/**'
```

## Kontext

Seit ADR-0013 führte OpenSpec den Änderungszyklus und Superpowers nur die Arbeitsdisziplin.
Ruben entschied am 18.11.2026, OpenSpec abzulösen und wieder allein mit Superpowers zu planen,
die Arbeit mit Zunder aber zu behalten (Zunder LLH-1967). Das OpenSpec-Archiv bleibt, weil Code, ADRs
und unveränderliche Migrationen auf seine Herleitungen verweisen.

## Konsequenzen

Entwürfe und Pläne liegen wieder unter `docs/superpowers/`, ohne Archivschritt vor dem PR. Die
Fähigkeits-Specs unter `openspec/specs/` werden nicht mehr fortgeschrieben und können veralten;
was gilt, steht in `AGENTS.md`-Dateien und ADRs. Die Zunder-Skills führen durch `superpowers:*`.
