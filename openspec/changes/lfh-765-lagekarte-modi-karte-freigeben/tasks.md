# Tasks

## 1. Vorrangregel und Leistenwahl

- [ ] 1.1 `leisteSichtbar` in `lagekarte/leistenWahl.ts` um `modusAktiv` und `imModus` erweitern (Vorrang nach design.md D1); Tabellentest in `leistenWahl.test.ts`, je Zeile eine Regel gekippt, zuerst rot
- [ ] 1.2 `useLeistenWahl(breit, modusAktiv)`: `imModus` plus `umschalteImModus()`, bei Modusende per Vorwert-Vergleich im Render zurückgesetzt; `verberge` entfernen. Hook-Test: Modusende setzt zurück, `localStorage` bleibt unberührt, `merke` löst weiterhin `vorlaeufig` ab

## 2. Fuß-Band PlatzierSteuerung

- [ ] 2.1 `lagekarte/PlatzierSteuerung.tsx` mit den Varianten `platzieren`/`zeichen`/`bild` (design.md D3), `bandStil('mitte')`, `data-lfh="platzier-steuerung"`; `PlatzierSteuerung.test.tsx`: Titel je Variante, „Abbrechen“ gegen „Fertig“ nach Zähler, Schalter „Weitere platzieren“, Griffwahl ruft `onGriffModus`, ohne Modus nichts gerendert

## 3. Sidebar ohne Doppelbedienung

- [ ] 3.1 Prop `modusBedienungImFuss` in `Sidebar.tsx` (design.md D4): „wird platziert“ statt „Abbrechen“ (Nicht verortet, Einsatzort), Hinweis statt Zeichen-Bedienung, Bild-Kasten ohne Griffwahl und „Fertig“; `Sidebar.test.tsx` mit Prop (Knöpfe fehlen, Hinweis da) und Gegenprobe ohne Prop

## 4. LagekartePage verdrahten

- [ ] 4.1 `LagekartePage.tsx`: `leisteErzwungen` = Auswahl oder (`breit` und Leistenmodus); `modusAktiv = exklusiverModusAktiv`; `karteFreigeben` entfernen; Kopfknopf unter `lg` im Modus auf `umschalteImModus`; `leisteSperrGrund` nach D5; `PlatzierSteuerung` unter `lg` in den `KartenFuss` mit Namen aus `nichtVerortetAlle`/Bildliste. Nachweis: `pnpm lint`, `tsc`, betroffene Vitest-Dateien grün
- [ ] 4.2 Kommentar an `leisteErzwungen`/`leistenWahl.ts` auf die neue Regel ziehen (Begründung D1/D2), keine toten Verweise auf `karteFreigeben`/`verberge` (`grep` leer)

## 5. e2e je Modus

- [ ] 5.1 `e2e/lagekarte-touch.spec.ts`: neues `describe` bei 390 und 768 px (`hasTouch`, Zeitachse ausgeklappt) mit Seeding einer unverorteten Einheit; Platzieren aus „Nicht verortet“ per Tipp → Position am Server, Leiste danach im vorherigen Zustand; bei 768 px mit Suchbegriff, der erhalten bleibt
- [ ] 5.2 Deeplink `?platzieren=einheit:<id>` bei 390 px: Leiste zu, Band-„Abbrechen“ getippt beendet den Modus
- [ ] 5.3 Taktisches Zeichen: Picker, Tipp auf die Karte, „Fertig“/„Abbrechen“ im Band getippt → Freies Zeichen am Server; während des Modus „Leiste einblenden“ getippt → genau ein „Abbrechen“ auf der Seite
- [ ] 5.4 Bild einpassen: Bild per Upload-API seeden, Einpassen starten, Griff „Verschieben“ per `elementFromPoint` frei, CDP-Touchzug ändert die gespeicherte Geometrie, „Fertig“ im Band getippt
- [ ] 5.5 Messen über den Kartenknopf: Leiste schließt (768 px), zwei Tipps ergeben einen Messwert, „Beenden“ getippt → Leiste im vorherigen Zustand
- [ ] 5.6 Bestehenden Zeichen-Test anpassen, wo er sitzungsweites Schließen voraussetzt (nach Speichern der Serie nicht mehr „Leiste einblenden“ als Dauerzustand); ganze Datei lokal grün

## 6. Doku und Abschluss

- [ ] 6.1 `CLAUDE.md`, Lagekarte: „Rest LFH-765“ durch die neue Regel ersetzen (Freigabe aus dem Modus, vorheriger Zustand, Band unter `lg`, Verweis auf dieses Design); `openspec validate lfh-765-lagekarte-modi-karte-freigeben` grün
- [ ] 6.2 `./scripts/check-all.sh` grün (bzw. Abweichungen mit Log belegt)
