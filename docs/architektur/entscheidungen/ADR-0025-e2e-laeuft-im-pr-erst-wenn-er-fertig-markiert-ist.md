---
id: ADR-0025
titel: Die e2e-Suite läuft im PR erst, wenn er fertig markiert ist, und ihre Pflicht-Checks fehlen davor
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - .github/workflows/ci.yml
  - .github/workflows/e2e.yml
  - scripts/ci-auswahl.sh
  - scripts/ci-stufen.test.sh
herleitung:
  - openspec/changes/archive/2026-11-12-k133wmg6-zweistufige-ci/design.md
  - Zunder LLH-1662 (Weg abgestimmt und Change freigegeben von Ruben am 12.11.2026)
---

# ADR-0025: Die e2e-Suite läuft im PR erst, wenn er fertig markiert ist, und ihre Pflicht-Checks fehlen davor

## Regeln

- MUST: Jeder Push auf einen PR startet nur die erste Stufe in `ci.yml` (Schnellprüfungen, Rust,
  Vitest). e2e-Binary und `e2e 1/4` bis `4/4` stehen in `e2e.yml`.
- MUST: Fertig heißt Auto-Merge an oder Label `e2e`. Ob die zweite Stufe startet, entscheidet
  allein das `if` der Auswahl in `e2e.yml`; die übrigen Jobs hängen an deren Ergebnis.
- MUST NOT: Vor der zweiten Stufe meldet kein Lauf `e2e-Binary` oder `e2e k/4` übersprungen oder
  leer grün; beide sind Matrix-Jobs, ihr gerenderter Name fehlt dann.
- MUST NOT: `ci.yml` hört auf keine weiteren `pull_request`-Ereignistypen (Auto-Merge, Labels).
- MUST: Push-Läufe auf Kanal-Branches rufen `e2e.yml` aus `ci.yml` auf, und `release` wartet
  darauf.
- MUST: Start- und Gruppenbedingung von `e2e.yml` ändern sich nur zusammen mit dem Wortlaut in
  `scripts/ci-stufen.test.sh` (Regel: `scripts/AGENTS.md`, „Zwei Stufen im PR“).

## Prüfung

```sh
verlange 'check: \[e2e-Binary\]' .github/workflows/e2e.yml
verlange 'name: e2e \$\{\{ matrix\.shard \}\}/4' .github/workflows/e2e.yml
verbiete '^    name: e2e-Binary' .github/workflows/ci.yml .github/workflows/e2e.yml
verbiete 'name: e2e \$\{\{ matrix|auto_merge_|labeled' .github/workflows/ci.yml
verlange 'uses: \./\.github/workflows/e2e\.yml' .github/workflows/ci.yml
verlange 'needs: \[schnell, rust, frontend, e2e\]' .github/workflows/ci.yml
```

## Kontext

Ein voller PR-Lauf belegte rund zwölf Jobs und eine Stunde, jeder Push startete ihn neu, und sechs
von zehn Läufen wurden abgebrochen oder galten einem überholten Stand. Die Grenze ist die Zahl
gleichzeitiger Jobs, nicht Geld. Die e2e-Suite braucht ein PR erst, wenn er fertig ist. Die
Pflicht-Checks hängen am Namen und am Kopf-Commit; ein übersprungener Job ohne Matrix erfüllte
seinen Check, ein übersprungener Matrix-Job nicht.

## Konsequenzen

Ein roter e2e-Fall fällt erst nach dem Einschalten von Auto-Merge auf; wer früher Rückmeldung
braucht, setzt das Label `e2e` oder fährt das Gate lokal. Auto-Merge wartet auf die fehlenden
Checks, ohne eigenes Zutun. Bei Push heißen die Checks `e2e / e2e k/4`; auf Kanal-Branches
verlangt das Ruleset keine. Der Stau-Wächter meldet einen PR mit Auto-Merge, an dem die Stufe nie
anlief.
