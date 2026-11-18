# Tasks

## 1. Wächter auf Nulltoleranz

- [x] 1.1 `frontend/src/theme/abstandsraster.guard.test.ts`: Schuldparameter und -prüfungen samt Unit-Tests entfernen, Kopfkommentar ohne Abschnitt SCHULD; Probe: ein Literal in eine Datei setzen → Test rot mit Datei/Zeile/Wert, zurücksetzen → grün (`npx vitest run src/theme/abstandsraster.guard.test.ts`)
- [x] 1.2 `frontend/src/theme/abstandsraster.schuld.ts` löschen; `git grep abstandsraster.schuld` findet außerhalb des Archivs nichts mehr

## 2. Entscheidung und Regeltexte

- [x] 2.1 Neue `docs/architektur/entscheidungen/ADR-0065-…` (ersetzt ADR-0059), ADR-0059 auf `status: ersetzt` mit `ersetzt_durch`; `scripts/check-adr.sh` bzw. der ADR-Schritt von `check-all.sh` grün, `scripts/adr-fuer.sh frontend/src/theme/tokens.ts` nennt ADR-0065
- [x] 2.2 `frontend/AGENTS.md`, Spiegelstrich „Abstandsraster“: Satz zur Altlast ersetzen (Wächter ohne Schuld, Ausnahmen bleiben); `pnpm design-system` erzeugt das README neu, `designSystem.guard.test.ts` grün
- [x] 2.3 `docs/architektur/11-risiken-und-technische-schulden.md`: Eintrag zu den Grenzen des Wächters nach dem Muster R20; Prettier/Doku-Wächter grün

## 3. Abschluss

- [x] 3.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Ausgabe ohne `| tail` lesen)

## Workflow follow-up

- `/opsx:archive` vor dem PR, im selben Branch
