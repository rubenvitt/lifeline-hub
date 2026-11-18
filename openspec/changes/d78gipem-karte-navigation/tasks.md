# Tasks

## 1. Schalter `kleben` an Rail und Modulpanel

- [ ] 1.1 `IconRail`: Prop `kleben?: boolean` (Vorgabe `true`); mit `false` Spalte ohne sticky mit `height: 100%`, keine Vorlauf-Messung, keine Variable `--lfh-rail-vorlauf`. Erst rote Tests in `IconRail.test.tsx` (aus: kein sticky, keine Fensterhöhe, kein `ResizeObserver` am `body`; an: wie bisher), dann grün
- [ ] 1.2 `ModulPanel`: Prop `kleben?: boolean` (Vorgabe `true`); mit `false` Spalte ohne sticky mit `height: 100%`, `useFitToWindow` abgeschaltet. Erst rote Tests in `ModulPanel.test.tsx` (aus: kein sticky, keine Höhe aus dem Fenster nach Scroll/Resize; an: wie bisher), dann grün

## 2. Karte „Navigation“

- [ ] 2.1 `NavigationBeispiel` in `frontend/scripts/design-system/previews.tsx` und Eintrag `Navigation` (Gruppe „Rahmen“) in `PREVIEWS` nach design.md D3; Höhe bei 720 px in Chromium bemessen
- [ ] 2.2 Zeile „Navigation im Einsatz“ in der Bausteinwahl von `frontend/AGENTS.md` (design.md D4); `designSystem.test.ts` grün (Abdeckungswächter)
- [ ] 2.3 `mise exec -- pnpm -C frontend design-system` laufen lassen, Erzeugtes mitcommitten; zweiter Lauf ohne Diff und `designSystem.guard.test.ts` grün (Bytegleichheit, auch Einsatzdauer)
- [ ] 2.4 Karte in Nacht und Tag ansehen (Bild aus dem erzeugten HTML), feste Höhe unabhängig von der Fenstergröße prüfen

## 3. Abschluss

- [ ] 3.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- `/opsx:archive` vor dem PR im selben Branch.
- Nach dem Merge das Design System aus `alpha` neu veröffentlichen (`frontend/AGENTS.md`, „Größere UI-Entwürfe über das Design System“).
