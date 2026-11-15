---
id: ADR-0050
titel: Das Label `voll` ist die Ausnahme und folgt festen Kriterien
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - .claude/skills/dev-zunder-ausfuehren/SKILL.md
  - .github/pull_request_template.md
  - .github/workflows/pr.yml
herleitung:
  - openspec/changes/archive/2026-11-15-r7bpwsde-voll-kriterien/design.md
  - Zunder LLH-1898 (Kriterien abgestimmt mit Ruben am 15.11.2026)
---

# ADR-0050: Das Label `voll` ist die Ausnahme und folgt festen Kriterien

## Regeln

- MUST: Es gelten die Kriterien in `scripts/AGENTS.md`, „Leichte PR-Prüfung“, „Wann `voll`“: ein
  Agent setzt `voll` nur, wenn der PR ändert, wie die Suiten selbst laufen, oder der Mensch es
  verlangt.
- MUST NOT: „Riskant“, Backend-Verhalten, UI-Abläufe, Migrationen oder CI-Änderungen außerhalb der
  Suiten sind kein Grund für `voll`; dafür gilt der lokale Lauf (`--geaendert --ohne-e2e`, bei
  UI-Abläufen gezielt die betroffene e2e-Spec).
- MUST: Diese ADR präzisiert das SHOULD aus ADR-0048 („eine riskante Änderung bekommt `voll`“);
  es gilt in dieser Lesart nicht mehr.

## Prüfung

```sh
verlange 'Wann `voll`' scripts/AGENTS.md
verlange 'Wann `voll`' .claude/skills/dev-zunder-ausfuehren/SKILL.md .github/pull_request_template.md
verbiete '[Rr]iskante[rn]? (Änderung|Umbau).*`voll`' .claude/skills/dev-zunder-ausfuehren/SKILL.md .github/pull_request_template.md scripts/AGENTS.md
```

## Kontext

Die Regel „riskante Änderung bekommt `voll`“ (Skill, ADR-0048, PR-Vorlage, drei Formulierungen)
traf fast jede Änderung. Ein PR mit `voll` belegt rund eine Stunde Runner und konkurriert mit den
Läufen auf `alpha`; Ruben empfand den Devflow dadurch als zäh (15.11.2026).

## Konsequenzen

`voll` bleibt die Ausnahme. Ein Agent entscheidet an Diff und Auftrag ohne Ermessen. Brüche, die
nur die Suiten zeigen, fallen häufiger erst auf `alpha` auf und laufen über „alpha rot“ (ADR-0049).
