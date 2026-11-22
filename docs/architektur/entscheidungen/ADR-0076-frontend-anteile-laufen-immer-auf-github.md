---
id: ADR-0076
titel: Die Frontend-Anteile laufen immer auf GitHub, auf dem eigenen Server nur Rust-Suite und e2e
status: ersetzt
datum: 2026-11-21
ersetzt_durch: ADR-0078
gilt_fuer:
  - .github/workflows/suiten.yml
herleitung:
  - docs/superpowers/specs/2026-11-21-gti2hj00-frontend-gehostet-design.md
  - LLH-2016 (mit Ruben am 21.11.2026 abgestimmt)
---

# ADR-0076: Die Frontend-Anteile laufen immer auf GitHub, auf dem eigenen Server nur Rust-Suite und e2e

## Regeln

- MUST: Der Job `frontend` in `suiten.yml` läuft auf `ubuntu-latest` und hängt nicht an der
  Runner-Wahl (`needs: runner`).
- MUST: Die Runner-Wahl aus ADR-0075 gilt nur noch für die Rust-Suite, `e2e-Binary` und die
  e2e-Anteile; ihre übrigen Regeln gelten unverändert.

## Prüfung

```sh
test "$(grep -c "needs\.runner\.outputs\.runner || 'ubuntu-latest'" .github/workflows/suiten.yml)" = 1
verlange "runs-on: [$][{][{] inputs\.runner [|][|] 'ubuntu-latest' [}][}]" .github/workflows/e2e.yml
# Die Job-Form im Detail: scripts/ci-stufen.test.sh (Schritt 11), „frontend: bleibt auf GitHub“.
```

## Kontext

Der eigene Server hat 12 Kerne und fährt vier Plätze. Ein Push brachte zehn Jobs dorthin; die
vier Frontend-Anteile belegten die Plätze, auf die Rust-Suite und e2e warteten, und gewannen
selbst am wenigsten, weil sie keinen Rust-Build haben, den `sccache` warm halten könnte.

## Konsequenzen

Auf dem Server laufen je Push höchstens sechs Jobs (Rust, Binary, vier e2e-Anteile), die
Frontend-Anteile wieder parallel bei GitHub. Diese ADR präzisiert ADR-0075 in diesem Punkt.
