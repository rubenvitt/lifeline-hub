---
id: ADR-0026
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

# ADR-0026: Die e2e-Suite läuft im PR erst, wenn er fertig markiert ist, und ihre Pflicht-Checks fehlen davor

## Regeln

- MUST: Es gelten die Regeln in `scripts/AGENTS.md`, „Zwei Stufen im PR“: erste Stufe in `ci.yml`
  bei jedem Push, e2e-Suite in `e2e.yml` erst am fertig markierten PR, ihre Pflicht-Checks fehlen
  davor, keine weiteren Ereignistypen in `ci.yml`, Kanal-Push ruft `e2e.yml` auf, Start- und
  Gruppenbedingung nur zusammen mit ihrem Wortlaut im Formtest.
- MUST: In `e2e.yml` steht die Start-Bedingung nur an der Auswahl (`aenderungen`); `binaer`, `e2e`
  und `berichte` hängen an deren Ergebnis, nie an einer eigenen Kopie der Bedingung.

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
Checks, ohne eigenes Zutun. Bei Push heißen die Checks `e2e (Kanal) / e2e k/4`; auf
Kanal-Branches verlangt das Ruleset keine. Der Stau-Wächter meldet einen PR mit Auto-Merge, an dem die Stufe nie
anlief.
