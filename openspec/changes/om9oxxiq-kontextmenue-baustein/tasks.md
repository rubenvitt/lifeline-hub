## 1. Schale und Riegel nach `components/` (D3, D5)

- [x] 1.1 Verweise auf `pages/lagekarte/PunktankerMenue` und `pages/lagekarte/nachklickRiegel` im Repo greppen (Code, `AGENTS.md`, `docs/`, `openspec/specs/`); Liste für 1.4 festhalten
- [x] 1.2 `PunktankerMenue.tsx` samt Test nach `frontend/src/components/` verschieben (`git mv`), Importe in Kartenfläche, Flächenwahl und Skizze nachziehen; bestehende Tests grün
- [x] 1.3 `nachklickRiegel.ts` samt Test nach `frontend/src/components/` verschieben, Lagekarte importiert von dort; bestehende Tests grün
- [x] 1.4 Verweise aus 1.1 nachziehen (`pages/lagekarte/AGENTS.md`, Kommentare, aktive Specs); archivierte Changes bleiben unverändert
- [x] 1.5 `PunktankerMenue` bekommt `bezug: 'huelle' | 'fenster'` per TDD: Test, dass der Anker bei `'fenster'` in `document.body` mit `position: fixed` an den Fensterkoordinaten steht und bei `'huelle'` unverändert absolut

## 2. Auslöser `useKontextMenue` (D1–D4)

- [x] 2.1 TDD: Rechtsklick (Maus) auf ein Element mit Einträgen ruft `onOeffnen` mit Zeigerpunkt und `ursprung: 'zeiger'` und verhindert das Browsermenü
- [x] 2.2 TDD: kein `preventDefault` und kein Öffnen auf `a[href]`, `input`, `textarea`, `select`, `[contenteditable]`, auf markiertem Text im Ziel und wenn `onOeffnen` „keine Einträge“ meldet
- [x] 2.3 TDD mit Scheinzeit: Touchdruck über 550 ms ohne Bewegung öffnet; Bewegung über 8 px, `pointerup` oder `pointercancel` davor öffnet nicht; Maus startet keinen Zeitgeber
- [x] 2.4 TDD: natives `contextmenu` während eines Touchdrucks wird unterdrückt (kein Doppelöffnen); `user-select`/`-webkit-touch-callout` am Element während des Drucks gesetzt und danach zurückgenommen
- [x] 2.5 TDD: nach dem Öffnen per langem Druck schärft der Hook den Nachklick-Riegel; das Abheben erzeugt keinen `click` am Element
- [x] 2.6 TDD: `ContextMenu` und Umschalt+F10 öffnen am Element (`ursprung: 'tastatur'`, Anker untere linke Ecke), auch auf einem Link, nicht in einem Eingabefeld; ein Folge-`contextmenu` innerhalb von 500 ms wird verworfen
- [x] 2.7 `istKontextTaste`, `LANGDRUCK_MS` und `LANGDRUCK_WEG` aus dem Hook exportieren; `stab/skizze/bedienung.ts` nutzt `istKontextTaste` (Test `bedienung.test.ts` bleibt grün)

## 3. `KontextMenue` für Datensätze (D6)

- [x] 3.1 TDD: `KontextMenue` zeigt `MenueEintrag[]` über `menueEintraege()` (Gefahr rot hinter einem Trenner, gesperrte Einträge deaktiviert) mit `aria-label`, Fokus im Menü
- [x] 3.2 TDD: Wahl ruft `onWahl(key)` genau einmal und löst kein Klickereignis eines umgebenden Elements aus; Escape schließt und gibt den Fokus an das Ursprungselement zurück
- [x] 3.3 TDD: `kontextEintraege(karte, zeile)` liefert Primäraktion (`__primaer`, nur wenn `sichtbar`) vor `weitere`, bei `laeuft` die `weitere`-Einträge gesperrt, ohne Aktionen eine leere Liste
- [x] 3.4 TDD: Wahl von `__primaer` mit `bestaetigung` öffnet `modal.confirm` mit gleichem Titel, Knopfbeschriftung und Gefahrfarbe; erst OK ruft `onKlick`; ohne `bestaetigung` ruft die Wahl `onKlick` sofort

## 4. Anbindung der `Datensicht` (D7)

- [x] 4.1 TDD: Tabellenzweig — Rechtsklick auf eine Zeile mit Aktionen öffnet das Menü dieser Zeile; Zeilenklick-Riegel und Fenster-Props über `onRow` wirken weiter (Bestandstests grün)
- [x] 4.2 TDD: Kartenzweig — Rechtsklick und langer Druck auf `datensicht-karte` öffnen das Menü; Wahl öffnet nicht den Titel-Link
- [x] 4.3 TDD: offenes Kontextmenü hält die Zeilenschleuse wie ein offenes ⋮ (`reportKartenMenue`); verschwindet die Zeile oder verliert sie alle Einträge, schließt das Menü
- [x] 4.4 Dokumente: Spalte im Tabellenzweig und Kartenplan zeigen dieselben Aktionen; Abweichung als eine Quelle zusammenführen (Material, Fahrzeuge, Personen dabei gegenprüfen) — geprüft: dieselben Aktionen in beiden Zweigen (Fahrzeuge führen „Entlassen“ in der Tabelle im ⋮, im Kartenplan als Primäraktion; Presse zeigt „Beantworten“ im Kartenplan, in der Tabelle als Statuswahl), keine Codeänderung nötig
- [x] 4.5 `datensicht.guard.test.ts` und übrige Datensicht-Tests grün

## 5. Skizze auf den Baustein (D3, D4)

- [x] 5.1 `SkizzenFlaeche.tsx`: eigenen Langdruck-Zeitgeber und `onContextMenu` am Element durch `useKontextMenue` ersetzen; `onKontext(key, px)` bleibt die Schnittstelle zu `FernmeldeskizzeBild`
- [ ] 5.2 Bestehende Skizzen-Tests und `e2e/fernmeldeskizze.spec.ts` (Kontextmenü, langer Druck, Tasten) grün; Verhalten aus Spec `stab-fernmeldeskizze-bearbeitung` unverändert

## 6. Wächter, Regeln, Doku

- [x] 6.1 `components/kontextMenue.guard.test.ts` (D8) mit Ausnahmen Lagemonitor und Skizzen-Übersicht, je mit Grund; ein toter Eintrag färbt rot
- [x] 6.2 `frontend/AGENTS.md`, Abschnitt Datensatz-Aktionen: Regel „Kontextmenü nur über `useKontextMenue` und `KontextMenue`, Einträge aus derselben Quelle wie das ⋮-Menü, Browsermenü auf Link/Feld/Markierung“; `pages/lagekarte/AGENTS.md` nennt die neuen Pfade von Schale und Riegel
- [x] 6.3 Anwenderdoku: `docs/anwender/kapitel/einsatz-oberflaeche.md` kurzer Absatz zum Kontextmenü an Listenzeilen (Rechtsklick, langer Druck, Umschalt+F10), `quellen:` um die neuen Bausteine ergänzt; Doku-Wächter grün

## 7. Browser-Nachweis und Gate

- [ ] 7.1 e2e `frontend/e2e/kontextmenue-datensatz.spec.ts`: Rechtsklick auf eine Materialzeile zeigt Primäraktion und ⋮-Einträge; Rechtsklick auf den Titel-Link öffnet kein eigenes Menü; Umschalt+F10 auf dem Titel-Link öffnet es, Escape gibt den Fokus zurück; langer Druck per CDP-Touch bei 390 px öffnet es und das Abheben navigiert nicht
- [ ] 7.2 `e2e/lagekarte-touch.spec.ts` grün (Riegel verschoben)
- [ ] 7.3 `./scripts/check-all.sh` grün
- [ ] 7.4 Bilder der Änderung (Kontextmenü in Tabelle und Karte) per Wegwerf-Spec aufnehmen

## Workflow follow-up

- `/opsx:archive om9oxxiq-kontextmenue-baustein` im selben Branch vor dem PR
- PR gegen `alpha`, Zunder LLH-1596 auf `review` mit `pr_url`
