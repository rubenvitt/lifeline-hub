# Proposal

## Why

Die Schuld des Abstandsraster-Wächters ist null: Alle 385 Altlast-Literale stehen seit LLH-1937 auf
dem Raster. ADR-0059 sah vor, dass Wächter und Schuldliste dann wegfallen; damit hätte die
Spec-Regel „Keine neuen Abstands-Literale“ (MUST) aber keine Prüfung mehr, und die Literale
könnten unbemerkt wieder wachsen. Am 18.11.2026 mit Ruben abgestimmt: Die Schuldliste fällt, der
Wächter bleibt als Nulltoleranz.

## What Changes

- Die Schuldliste `frontend/src/theme/abstandsraster.schuld.ts` entfällt; der Wächter
  `abstandsraster.guard.test.ts` prüft ohne Schuld: jedes Abstands-Literal über 2 px ist rot.
- Spec `abstandsraster`: Die Regel „Keine neuen Abstands-Literale“ wird zu „Abstände ohne Literal“, ohne den Satz zur Schuld je
  Datei, das Szenario „Schuld sinkt“ entfällt.
- Neue ADR-0067 ersetzt ADR-0059: dieselben Raster-Regeln, statt der Schuld-Regel die
  Nulltoleranz des bleibenden Wächters. ADR-0059 bekommt `status: ersetzt`.
- `frontend/AGENTS.md`, Spiegelstrich „Abstandsraster“: ohne den Satz zur Altlast; das Design
  System (README) wird neu erzeugt.
- Kapitel 11: ein Eintrag zu den bekannten Grenzen des Wächters (wie R20 beim Zeitdarstellungs-Guard).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `abstandsraster`: „Keine neuen Abstands-Literale“ wird durch „Abstände ohne Literal“ ersetzt (dieselbe Regel ohne Schuld; das Szenario „Schuld sinkt“ entfällt).

## Impact

- `frontend/src/theme/abstandsraster.guard.test.ts`, `abstandsraster.schuld.ts` (gelöscht)
- `docs/architektur/entscheidungen/ADR-0059-…`, neue `ADR-0067-…`, `docs/architektur/11-risiken-und-technische-schulden.md`
- `frontend/AGENTS.md`, `docs/design/design-system/project/README.md` (generiert)
- Kein Laufzeitcode, keine Daten, kein Server.
