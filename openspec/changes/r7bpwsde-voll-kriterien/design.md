# Design

## Context

Motivation: proposal.md. Das Label wirkt über `pr.yml` (Aufruf von `suiten.yml` nur mit `voll`).
Was ein Agent vor dem PR lokal fährt, regelt `scripts/AGENTS.md`, „Leichte PR-Prüfung“.

## Goals / Non-Goals

**Goals:** Ein Agent entscheidet an Diff und Auftrag allein, ohne Ermessen bei „riskant“.

**Non-Goals:** Keine Prüfung in der CI, ob `voll` zu Recht gesetzt ist (das Label setzt auch der
Mensch). Kein Ersatz für die e2e-Suite im PR.

## Decisions

### D1: Kriterium ist der Ort der Änderung, nicht ihr Risiko
Nur was die Suiten selbst verändert, lässt sich lokal nicht belegen: Workflows der Suiten, Runner,
Test-Konfiguration. Alles andere fährt ein Agent lokal (`--geaendert --ohne-e2e`, gezielt die
betroffene e2e-Spec) oder fängt `alpha` („alpha rot“). Verworfen: eine Liste riskanter Bereiche
(Migrationen, Auth, Live-Kanal); sie wüchse und brächte das Ermessen zurück.

### D2: Eine Stelle, Verweise sonst
Die Regel steht in `scripts/AGENTS.md`. Skill und PR-Vorlage nennen sie nur mit Verweis, damit sie
nicht wieder auseinanderlaufen (heute drei Formulierungen).

### D3: Neue ADR präzisiert ADR-0048
ADR-0048 ist akzeptiert, ihr SHOULD „eine riskante Änderung bekommt `voll`“ bleibt stehen. Die
neue ADR ersetzt sie nicht, sondern präzisiert diesen Punkt (`docs/architektur/AGENTS.md`:
Widersprüche werden ersetzt oder präzisiert).

## Risks / Trade-offs

- [Mehr Brüche erst auf `alpha`] → Gewollt (Entscheidung Ruben); „alpha rot“ bestimmt einen
  Zuständigen.
