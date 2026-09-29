# Tasks

## 1. Vorrangregel und Leistenwahl

- [x] 1.1 `leisteSichtbar` in `lagekarte/leistenWahl.ts` um `modusAktiv` und `imModus` erweitern (Vorrang nach design.md D1); Tabellentest in `leistenWahl.test.ts`, je Zeile eine Regel gekippt, zuerst rot
- [x] 1.2 `useLeistenWahl(breit, modusAktiv)`: `imModus` plus `umschalteImModus()`, bei Modusende per Vorwert-Vergleich im Render zurückgesetzt; `verberge` entfernen. Hook-Test: Modusende setzt zurück, `localStorage` bleibt unberührt, `merke` löst weiterhin `vorlaeufig` ab

## 2. Fuß-Band PlatzierSteuerung

- [x] 2.1 `lagekarte/PlatzierSteuerung.tsx` mit den Varianten `platzieren`/`zeichen`/`bild` (design.md D3), `bandStil('mitte')`, `data-lfh="platzier-steuerung"`; `PlatzierSteuerung.test.tsx`: Titel je Variante, „Abbrechen“ gegen „Fertig“ nach Zähler, Schalter „Weitere platzieren“, Griffwahl ruft `onGriffModus`, ohne Modus nichts gerendert

## 3. Sidebar ohne Doppelbedienung

- [x] 3.1 Prop `modusBedienungImFuss` in `Sidebar.tsx` (design.md D4): „wird platziert“ statt „Abbrechen“ (Nicht verortet, Einsatzort), Hinweis statt Zeichen-Bedienung, Bild-Kasten ohne Griffwahl und „Fertig“; `Sidebar.test.tsx` mit Prop (Knöpfe fehlen, Hinweis da) und Gegenprobe ohne Prop

## 4. LagekartePage verdrahten

- [x] 4.1 `LagekartePage.tsx`: `leisteErzwungen` = Auswahl oder (`breit` und Leistenmodus); `modusAktiv = exklusiverModusAktiv`; `karteFreigeben` entfernen; Kopfknopf unter `lg` im Modus auf `umschalteImModus`; `leisteSperrGrund` nach D5; `PlatzierSteuerung` unter `lg` in den `KartenFuss` mit Namen aus `nichtVerortetAlle`/Bildliste. Nachweis: `pnpm lint`, `tsc`, betroffene Vitest-Dateien grün
- [x] 4.2 Kommentar an `leisteErzwungen`/`leistenWahl.ts` auf die neue Regel ziehen (Begründung D1/D2), keine toten Verweise auf `karteFreigeben`/`verberge` (`grep` leer)

## 5. e2e je Modus

- [x] 5.1 `e2e/lagekarte-touch.spec.ts`: neues `describe` bei 390 und 768 px (`hasTouch`, Zeitachse ausgeklappt) mit Seeding einer unverorteten Einheit; Platzieren aus „Nicht verortet“ per Tipp → Position am Server, Leiste danach im vorherigen Zustand; bei 768 px mit Suchbegriff, der erhalten bleibt
- [x] 5.2 Deeplink `?platzieren=schaden:<id>` bei 390 und 768 px (`einheit` kennt `PLATZIEREN_ZIEL_ERLAUBT` nicht): Leiste zu, Band-„Abbrechen“ getippt beendet den Modus
- [x] 5.3 Taktisches Zeichen: Picker, Tipp auf die Karte, „Fertig“/„Abbrechen“ im Band getippt → Freies Zeichen am Server (die Probe „genau ein Abbrechen bei eingeblendeter Leiste“ steht im Platzier-Test 5.1)
- [x] 5.4 Bild einpassen: Bild per Upload-API seeden, Einpassen starten, Griff „Verschieben“ per `elementFromPoint` frei, CDP-Touchzug ändert die gespeicherte Geometrie, „Fertig“ im Band getippt
- [x] 5.5 Messen über den Kartenknopf: Leiste schließt (768 px), zwei Tipps ergeben einen Messwert, „Beenden“ getippt → Leiste im vorherigen Zustand
- [x] 5.6 Bestehenden Zeichen-Test prüfen (bleibt mit der neuen Regel schlüssig, keine Änderung nötig); ganze Datei lokal grün (16/16)
- [x] 5.7 Review-Befund: Stift („Zeichenwerkzeuge“) im Modus unter `lg` setzt `umschalteImModus(true)` statt `zeige()`; Seitentest „Stift während Messen bei 390 px“, zuerst rot

## 6. Doku und Abschluss

- [x] 6.1 `CLAUDE.md`, Lagekarte: „Rest LFH-765“ durch die neue Regel ersetzen (Freigabe aus dem Modus, vorheriger Zustand, Band unter `lg`, Verweis auf dieses Design); `openspec validate lfh-765-lagekarte-modi-karte-freigeben` grün
- [ ] 6.2 `./scripts/check-all.sh` grün (bzw. Abweichungen mit Log belegt)
