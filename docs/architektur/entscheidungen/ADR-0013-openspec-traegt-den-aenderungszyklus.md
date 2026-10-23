---
id: ADR-0013
titel: OpenSpec trägt den Änderungszyklus, Fähigkeits-Specs liegen unter openspec/specs
status: akzeptiert
datum: 2026-09-20
gilt_fuer:
  - openspec/**
  - scripts/check-openspec-archiv.sh
herleitung:
  - openspec/changes/archive/2026-09-30-lfh-589-entwurfs-hoheit-orchestrierung/design.md
---

# ADR-0013: OpenSpec trägt den Änderungszyklus, Fähigkeits-Specs liegen unter openspec/specs

## Regeln

- MUST: Eine Änderung auf der Route `entwurf` entsteht als Change unter `openspec/changes/<name>/`
  (Vorschlag, Design, Delta-Specs, `tasks.md`) und wird vor dem Merge im selben Branch nach
  `openspec/changes/archive/` archiviert; Ablauf und Pflicht-Checkpoint: Wurzel-`AGENTS.md`,
  „Planung und Ausführung — OpenSpec und Superpowers“.
- MUST: Fähigkeiten stehen als SHALL/MUST-Requirements in `openspec/specs/<name>/spec.md`,
  übernommen beim Archivieren.
- MUST NOT: nichts Neues unter `docs/superpowers/`; es ist eingefrorenes Archiv (Wurzel-`AGENTS.md`,
  ebenda, „Vier Ablageorte“).
- MUST: Eine Change mit Entscheidung (E1) zieht eine ADR mit, die auf ihr Archiv-`design.md`
  verweist; Pflicht und Form: `docs/architektur/AGENTS.md`, „Mitänderungsregel“ und
  „Entscheidungen (ADRs)“.

## Prüfung

```sh
test -f openspec/config.yaml
test -d openspec/specs
test -x scripts/check-openspec-archiv.sh
verlange 'check-openspec-archiv\.sh' scripts/check-all.sh
verlange '^schema: spec-driven' openspec/config.yaml
```

## Kontext

Bis September 2026 lagen Entwürfe und Pläne als Superpowers-Specs unter `docs/superpowers/`,
gegliedert als Herleitung, nicht als Anforderung. Die Prüfung vom 20.09.2026 ergab: OpenSpec
ersetzt Superpowers nicht, übernimmt aber den Änderungszyklus, Superpowers bleibt für die
Arbeitsdisziplin (Zunder LLH-481, LFH-588). LFH-589 legte danach fest, wann genau eine Change
entsteht.

## Konsequenzen

Jede größere Änderung hinterlässt ein Design mit Herleitung im Archiv und hält die Specs aktuell;
die ADRs verweisen darauf, statt die Begründung zu kopieren. Eine fertige, nicht archivierte
Change macht das Gate rot. Ältere Herleitungen liegen weiter unter `docs/superpowers/` und können
veraltet sein.
