# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Commits und PR nennen `LFH-888`. Vor jeder Datei die `AGENTS.md` auf ihrem Pfad
lesen (`frontend/AGENTS.md`, dazu `stab/`, `etb/`, `pages/lagekarte/`, `personen/` je nach Datei).

## 1. Registry: Sprung-Prüfung und Rückwegziel

- [x] 1.1 `einsatz/modulRegistry.ts`: `istSprungGesperrt(key, freigaben)` (gesperrt nur bei bekanntem `zugriff === false`, unbekannter Key nie gesperrt), Konstante `KEINE_BERECHTIGUNG`, `freiesRueckwegModul(freigaben, standardModul?)` nach design.md D3. Verifiziert durch neue Fälle in `modulRegistry.test.ts`: gesperrt / frei / unbekannt / Admin mit ausgeblendetem Modul (nicht gesperrt), Rückweg auf Standardmodul, auf Überblick bei gesperrtem Standardmodul, auf erstes freies Modul, auf `einsatzdaten` bei sonst nichts Freiem. Mutationsprobe: `istSprungGesperrt` auf die strenge Lesart (`!istKeyFreigegeben`) → Fall „unbekannt“ rot
- [x] 1.2 Hook `einsatz/useSprungSperre.ts` (`(key) => boolean` aus dem Cache `einsatzKeys.modulFreigaben`, kein zweiter Abruf). Verifiziert durch einen Hook-Test: ein Abruf der Freigaben bei zwei Aufrufern, Sperre folgt der Antwort

## 2. Rahmen: Modulwächter

- [x] 2.1 `einsatz/ModulGesperrt.tsx` nach design.md D2 (Paneel, Modulname als `h1`, Grund je `sichtbar`, wer es ändern kann, Rückweg als eine Primäraktion). Verifiziert durch `ModulGesperrt.test.tsx`: Text „ausgeblendet“ bzw. „nicht freigegeben“, genau ein Knopf, Rückweg navigiert auf den übergebenen Pfad
- [x] 2.2 `einsatz/EinsatzLayout.tsx`: Wächter statt `<Outlet>` nach design.md D1, Rückweg über `freiesRueckwegModul` mit dem Standardmodul aus `einsatzKeys.einstellungen`. Verifiziert durch `EinsatzLayout.test.tsx`: (a) gesperrtes Modul → Hinweis, Kindseite nicht gerendert, Rail weiter bedienbar; (b) Unterroute (`stab/funkplan`) eines gesperrten Moduls → Hinweis; (c) Freigaben laden / scheitern → Kindseite; (d) Admin mit `sichtbar: false, zugriff: true` → Kindseite; (e) `einsatzdaten` nie Hinweis. Mutationsprobe: Wächter auf `!istModulFreigegeben` → (c) rot
- [x] 2.3 Rückwege der Sackgassen: `einsatz/ModulStub.tsx` und `stab/useStabFreigabe.tsx` auf `freiesRueckwegModul`. Verifiziert durch `ModulStub.test.tsx` und den Test von `useStabFreigabe` (gesperrter Überblick → Rückweg auf ein freies Modul)
- [x] 2.4 Bestehende Literale „Keine Berechtigung“ (`einsatz/ModulPanel.tsx`, `pages/lagekarte/personenEbene.ts`, `pages/lagekarte/betreuungEbene.ts`) auf `KEINE_BERECHTIGUNG`. Verifiziert durch die bestehenden Tests dieser Dateien grün und `grep -rn "'Keine Berechtigung'" frontend/src --include=*.ts --include=*.tsx | grep -v test` leer

## 3. Sprungstellen nach design.md D4

- [x] 3.1 Führung: `pages/fuehrung/UeberblickPage.tsx` (Kopf „Lagebericht“, „Eintrag“, Kennzahl „Kräfte im Einsatz“, Marke „Lagebesprechung“) und `pages/lage-dashboard/lagebild.ts` bzw. `LageDashboardPage.tsx` (Kennzahl „Kräfte“). Verifiziert durch Seitentests je Stelle: Ziel gesperrt → Knopf `disabled` mit `title="Keine Berechtigung"` bzw. Kennzahl ohne Link; Ziel frei → wie bisher; Freigaben laden → wie bisher. Mutationsprobe an einer Stelle
- [ ] 3.2 Kräfte: `pages/KraefteuebersichtPage.tsx` (Kopf „Einheit“, Leeraktion „Einheit bilden“, „In Lagebericht übernehmen“) und `kraefte/Verdichtungszeile.tsx` („Meldebild ↗“ entfällt bei Sperre). Vorher `frontend/src/kraefte/AGENTS.md` lesen. Verifiziert durch Tests je Stelle wie 3.1
- [ ] 3.3 Detailköpfe: `pages/BefehlDetailPage.tsx`, `pages/LageberichtDetailPage.tsx`, `pages/PressemitteilungDetailPage.tsx` („Zum ETB-Eintrag“ wird bei Sperre ein gesperrter Knopf) und `pages/uhs/UhsDetailPage.tsx` („Patient aufnehmen“). Verifiziert durch Tests je Seite wie 3.1
- [ ] 3.4 Sprünge auf die Lagekarte: `pages/gefahren/GefahrenPage.tsx` (Kopf, Leeraktion), `pages/BetreuungPage.tsx` (Zeilenaktionen), `pages/PersonenDetailPage.tsx`, `pages/schaeden/SchadenDaten.tsx`. Vorher `frontend/src/betreuung/AGENTS.md` und `frontend/src/personen/AGENTS.md` lesen. Verifiziert durch Tests je Stelle wie 3.1
- [ ] 3.5 Lagekarte und ETB: `pages/lagekarte/ZonenInspector.tsx` („Matrix öffnen“), `pages/lagekarte/Inspector.tsx` („ETB zu Einheit“, „Im Fachmodul öffnen“ für Führungskraft und Lagemeldung) und `etb/Schnellerfassung.tsx` (Verweis „Als strukturierten Lagebericht erfassen →“ entfällt). Vorher `frontend/src/pages/lagekarte/AGENTS.md` und `frontend/src/etb/AGENTS.md` lesen. Verifiziert durch Tests je Stelle wie 3.1

## 4. Regel, Akzeptanz, Abschluss

- [ ] 4.1 `frontend/AGENTS.md` nach design.md D5 fortschreiben. Verifiziert durch `prettier --check frontend/AGENTS.md`
- [ ] 4.2 e2e: `e2e/modulfreigabe-org-vorgabe.spec.ts` um den Deeplink `/einsaetze/:id/lagemeldungen` als Beobachter erweitern: Hinweis mit „Lagemeldungen“ sichtbar, kein Request an `/lage/meldungen`, Rückweg führt in ein freies Modul. Vorher `frontend/e2e/AGENTS.md` lesen. Verifiziert durch den grünen e2e-Lauf der Spec und eine Mutationsprobe (Wächter aus → rot)
- [ ] 4.3 `./scripts/check-all.sh` grün, Vitest und betroffene e2e-Specs grün. Verifiziert durch den Exit-Code bzw. die CI des PRs
