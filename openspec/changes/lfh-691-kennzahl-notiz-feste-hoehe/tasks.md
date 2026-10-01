# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote
Test, dann der Code.

## 1. Baustein: feste Notizhöhe ab `md`

- [x] 1.1 `components/instrument/Kennzahl.tsx`: `Kennzahlenband` bekommt `notizZeilen?: number` nach design.md D2 (Klasse `lfh-kennzahlenband--notizfest`, Custom-Property `--lfh-kennzahl-notizzeilen-fest`); ohne die Prop weder Klasse noch Property. Verifiziert durch einen neuen Test in `Kennzahl.test.tsx` nach dem Muster des LFH-629-Tests („fordert den Notizplatz unter `md` nur mit `notizZeilenSchmal` an“): Band mit Prop trägt Klasse und Property-Wert `3`, Band ohne Prop keins von beiden, `notizZeilenSchmal` unverändert
- [x] 1.2 `Kennzahl.tsx`: Kontext des Bands nach design.md D3; `Kennzahl` setzt im Zustand `daten` an eine `string`-Notiz `title`, nur innerhalb eines Bands mit `notizZeilen`. Verifiziert durch Tests: im festen Band trägt die Notiz `title` mit dem vollen Text; im Band ohne Prop kein `title`; im Zustand `fehler` und `laden` kein `title` an der Notiz (`getByTitle('Stand unbekannt')` findet genau ein Element); der zugängliche Name des Links enthält den vollen Notiztext
- [x] 1.3 `theme/sprache.css`: Regel unter `@media (min-width: 768px)` für `.lfh-kennzahlenband--notizfest [data-lfh='kennzahl-notiz']` mit `min-height: calc(var(--lfh-kennzahl-notizzeilen-fest) * 1.4em)`, `display: -webkit-box`, `-webkit-box-orient: vertical`, `-webkit-line-clamp` und `line-clamp` aus derselben Property, `overflow: hidden`; Kommentar mit Grund (LFH-691) und Verweis auf diese Change. Dateikopf von `Kennzahl.tsx` um einen Absatz „NOTIZHÖHE“ ergänzen (LFH-629 unter `md`, LFH-691 ab `md`). Verifiziert durch den e2e-Spec in 2.1 (Vitest fährt ohne CSS)

## 2. Verbraucher und Nachweis im Browser

- [x] 2.1 `e2e/kennzahlenband-notizhoehe.spec.ts` nach design.md D4 (Standmeldung, Pegel kurz/lang, keine Aussage verloren, Kürzung trägt den Text) bei 1200, 1440 und 1920 px; Bandhöhen als Annotation. Zuerst rot gegen den Bestand laufen lassen (Messwert notieren), dann grün nach 2.2. Verifiziert durch den grünen Spec und die **Mutationsprobe**: `notizZeilen` am Lage-Dashboard entfernt → Standmeldung und Pegel rot. Gemessen: vor 2.2 alle 9 Fälle rot (Standmeldung 103,8 → 89,5 px bei 1200/1440, Pegel kurz → lang 104,9 → 135,7 / 120,3 → 135,7 / 89,5 → 104,9 px, Notizen 15,4 statt 46,2 px); nach 2.2 alle 9 grün, Band bei 1200/1440/1920 konstant 120,3 px, Paneele bei y = 237,3 px, jede Notiz 46,2 px. Zweite Probe: Deckel (`line-clamp`) entfernt → Pegel bei 1200 px rot (120,3 → 135,7 px)
- [x] 2.2 `pages/lage-dashboard/LageDashboardPage.tsx` (Band „Lage in Zahlen“) und `pages/fuehrung/UeberblickPage.tsx` setzen `notizZeilen={3}` neben `notizZeilenSchmal={2}`; Kommentar am Band nennt LFH-691. Verifiziert durch 2.1 sowie `pnpm vitest run src/components/instrument src/pages/lage-dashboard src/pages/fuehrung` grün
- [ ] 2.3 Bestehende Specs, die Band oder Notiz messen, bleiben grün: `lagebild-cls-schmal`, `lage-dashboard-schmal`, `gate1-ueberlauf`, `gate3-trefflaeche`, `pegel-pruefliste`. Verifiziert durch ihren Lauf (Ergebnis hier vermerken)

## 3. Regel und Prüfliste

- [x] 3.1 `frontend/AGENTS.md`, Bausteinregel „Kennzahlenband“: ein Satz zur Notizhöhe (unter `md` Boden `notizZeilenSchmal`, ab `md` Boden und Deckel `notizZeilen`, „Lage in Zahlen“ drei Zeilen; tragende Aussage einer Notiz steht vorn), Verweis auf diese Change. Verifiziert durch `prettier --check frontend/AGENTS.md`
- [x] 3.2 `openspec/changes/archive/2026-09-29-lfh-607-kennzahl-evakuiert/pruefliste.md`, Kriterium 12: „offen → LFH-691“ als eingelöst durch LFH-691 vermerken, mit Verweis auf den Spec aus 2.1. Verifiziert durch `grep -n 'LFH-691' openspec/changes/archive/2026-09-29-lfh-607-kennzahl-evakuiert/pruefliste.md`

## 4. Verifikation

- [ ] 4.1 `./scripts/check-all.sh` grün (Format, Lint, Vitest, e2e, OpenSpec-Archivwächter nach `/opsx:archive`). Verifiziert durch den Exit-Code des Skripts bzw. die CI des PRs
- [ ] 4.2 Im Browser gegen den e2e- oder Dev-Stack, Lage-Dashboard bei 1440 × 900: Band vor und nach einer Standmeldung gleich hoch, „ohne Meldung“ ganz sichtbar, lange Pegel-Notiz bei 1200 px mit „…“ und Hinweistext. Verifiziert durch je einen Screenshot
