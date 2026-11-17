# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/wf7l9axngan7796bqcgzckh2 (LLH-1748). Jede Aufgabe
entsteht per TDD: erst der rote Test, dann der Code.

## 1. Überblick ohne Band, Fristen oben

- [x] 1.1 In `frontend/src/pages/fuehrung/UeberblickPage.test.tsx` die Tests des Bands „Führungsstand“ auf das Zielbild umstellen. Es gibt keine Gruppe „Führungsstand“, die erste Paneelreihe trägt „Nächste Marken“ vor „Offene Vorgänge“ und die zweite „Einsatzabschnitte“ vor den Entscheidungen. Zahlen, Notizen, „nicht freigegeben“ und Laden prüfen die Tests im Abschnitt von „Offene Vorgänge“, wo sie noch nicht abgedeckt sind. Der „Zuletzt“-Test klickt den Sprung „alle“ des Abschnitts „Aufträge“ und erwartet `['auftraege']`. Nachweis: Die Tests laufen rot gegen den alten Stand.
- [x] 1.2 In `UeberblickPage.tsx` das `Kennzahlenband` entfernen und die Reihen tauschen (design.md D2; Kennung `ueberblick-paneele-gliederung` für Reihe 2). Die Ladeschranken bleiben (D3), der Kommentar zum Band entfällt. Nachweis: Die Tests aus 1.1 sind grün, `pnpm -C frontend exec vitest run src/pages/fuehrung` grün.
- [x] 1.3 Helfer, die nur das Band las (etwa `auftraegeKennzahl`, `abschnittNamen`, `bandSpalten`, `kennzahlZustand` der Seite), samt ihren Tests in `ueberblickDaten.test.ts` entfernen. Geteilte Helfer (`fuehrungsZahlen.ts`, von Vorbereitung und Alarmzeile genutzt) bleiben. Nachweis: `pnpm -C frontend lint` und `tsc` ohne ungenutzte Exporte, die Vitest-Suite von `pages/` grün.

## 2. Beschreibung des Moduls

- [x] 2.1 In `einsatz/modulRegistry.ts` die Beschreibung des Überblicks auf „Fristen, Vorgänge, Entscheidungen“ setzen und Tests, e2e-Specs und die Kopie der Website (`website/src/daten/module.json`, Wächter `websiteModule.guard.test.ts`), die den alten Wortlaut tragen, nachziehen (`grep -rn "Kennzahlen, Fristen, Entscheidungen" frontend docs`). Nachweis: Der grep findet nur noch Archiv und eingefrorene Doku, die betroffenen Unit-Tests sind grün.

## 3. e2e-Specs

- [x] 3.1 Überblick-Fälle, die am Band messen, umstellen: `kennzahlenband-notizhoehe` und `fugenraster-leerzelle` (Überblick-Fall entfällt, Lagebild-Fälle bleiben), `ueberblick-vorgaenge-cls` und `ueberblick-startliste` (Bezug auf „Führungsstand“ und Reihenkennung), `lagebesprechung-vorbereitung` (Zahl aus dem Abschnitt „Aufträge“ statt aus der Kennzahl), `hellmodus-kontrast` (Kontrastprobe an „Offene Vorgänge“), `pegel-pruefliste` (nur Kommentar). Eine neue Probe hält fest, dass „Nächste Marken“ am Fükw (1440 × 900) ohne Startliste innerhalb der ersten 900 px beginnt und bei 390 px als erstes Paneel steht (Spec `lage-verdichtung`, „Fristen über der Falz“, „Fristen zuerst am Handy“). Nachweis: Die geänderten Specs laufen lokal grün (`pnpm -C frontend exec playwright test <specs> --trace off`).

## 4. Regeln, Design System, Anwenderdoku

- [x] 4.1 `frontend/AGENTS.md` nachziehen: „Kennzahlenband“ (nur „Lage in Zahlen“), „Dashboard-Baukasten“ (Reihe 1 im Überblick: Paneelreihe Marken | Vorgänge, kein Band) und „Rollen der Übersichten“. Nachweis: `grep -n "Führungsstand" frontend/AGENTS.md` findet nichts mehr, Prettier ist grün.
- [x] 4.2 Design System erzeugen (`mise exec -- pnpm -C frontend design-system`) und das Erzeugte committen. Nachweis: `designSystem.guard.test.ts` grün, `grep -rn "Führungsstand" docs/design/design-system/project` leer.
- [x] 4.3 Anwenderkapitel `docs/anwender/kapitel/ueberblick.md` umschreiben (kein Führungsstand, Zahlen in „Offene Vorgänge“, Reihenfolge, Alt-Text des Bilds), dazu den Kopf von `e2e/doku-bilder/ueberblick.bilder.ts`. Die Bilder neu erzeugen: `ueberblick` und jedes weitere Kapitel, dessen Bild den Überblick zeigt (`grep -ln "ueberblick" e2e/doku-bilder/*.bilder.ts`). Nachweis: Der Wächter der Anwenderdoku (`hilfe/anwenderdoku.guard.test.ts`) ist grün, das neue Bild zeigt keine Zeile „Führungsstand“.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, Ergebnis im PR unter „Geprüft“. Die e2e-Specs aus 3.1 liefen lokal grün.

## Workflow follow-up

- Bilder der Änderung (vorher/nachher, Fükw und Handy) in PR und Meldung.
- `/opsx:archive wf7l9axn-ueberblick-ohne-band` vor dem PR, im selben Branch.
- Nach dem Merge das Design System neu veröffentlichen (`frontend/AGENTS.md`, „Das Design System ist aus dem Code erzeugt“).
- Aufgabe aufs Board: Die Spec `gefahrenmatrix` nennt noch eine „Kennzahl ‚Warnstufe‘ im Überblick“.
