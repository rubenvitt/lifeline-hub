---
id: ADR-0050
titel: Das Label `voll` ist die Ausnahme und folgt festen Kriterien
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - .github/workflows/*.yml
  - scripts/AGENTS.md
  - .claude/skills/dev-zunder-ausfuehren/SKILL.md
  - .github/pull_request_template.md
herleitung:
  - openspec/changes/archive/2026-11-15-r7bpwsde-voll-kriterien/design.md
  - Zunder LLH-1898 (Kriterien abgestimmt mit Ruben am 15.11.2026)
---

# ADR-0050: Das Label `voll` ist die Ausnahme und folgt festen Kriterien

## Regeln

- MUST: Ein Agent setzt `voll` nur nach der abschließenden Liste in `scripts/AGENTS.md`,
  „Leichte PR-Prüfung“, „Wann `voll`“, oder wenn der Mensch es verlangt.
- MUST NOT: Ein Agent setzt `voll`, weil eine Änderung riskant scheint; was sonst vor dem PR
  lokal läuft, steht an derselben Stelle.

## Prüfung

```sh
verlange 'Wann `voll`' scripts/AGENTS.md
verlange 'Wann `voll`' .claude/skills/dev-zunder-ausfuehren/SKILL.md
verlange 'Wann `voll`' .github/pull_request_template.md
verlange 'nicht weil eine Änderung' .claude/skills/dev-zunder-ausfuehren/SKILL.md
verbiete 'Änderung riskant|[Rr]iskanter Umbau' .claude/skills/dev-zunder-ausfuehren/SKILL.md .github/pull_request_template.md
```

## Kontext

Die Regel „riskante Änderung bekommt `voll`“ (Skill, ADR-0048, PR-Vorlage, drei Formulierungen)
traf fast jede Änderung. Diese ADR präzisiert das SHOULD aus ADR-0048 in diesem Punkt; ihre
übrigen Regeln gelten unverändert. Ein PR mit `voll` belegt rund eine Stunde Runner und
konkurriert mit den Läufen auf `alpha`; Ruben empfand den Devflow dadurch als zäh (15.11.2026).

## Konsequenzen

`voll` bleibt die Ausnahme. Ein Agent entscheidet an Diff und Auftrag ohne Ermessen. Brüche, die
nur die Suiten zeigen, fallen häufiger erst auf `alpha` auf und laufen über „alpha rot“ (ADR-0049).
