# Tasks

Jede Aufgabe per TDD: Test zuerst rot, dann grün. Pfade relativ zu `frontend/src/`, e2e unter
`frontend/e2e/`.

## 1. Anflug zoomt nur heran (D5)

- [x] 1.1 `anflugZoom(aktuell)` in `pages/lagekarte/kamera.ts` (Ergebnis `max(aktuell, ANFLUG_ZOOM)`) mit Unit-Test für Zoom 12, 15 und 18; Test grün
- [x] 1.2 Der Effekt `flyToZiel` in `pages/lagekarte/Kartenflaeche.tsx` fliegt mit `anflugZoom(map.getZoom())` und `BEDIENUNG`; `kamera.guard.test.ts` bleibt grün (der Aufruf bleibt dafür in `Kartenflaeche`), den Zoom an der echten Karte prüft e2e 2.3

## 2. Marker-Tipp ohne Kamera (D4)

- [x] 2.1 `onMarkerWaehlen` (`pages/lagekarte/useKartenInteraktion.ts`) bekommt die Angabe „anfliegen“; ohne sie bleibt `flyToZiel` ungesetzt. Unit-Test am Hook: Auswahl gesetzt, `flyToZiel` unverändert bzw. gesetzt
- [x] 2.2 `LagekartePage`: Der Marker-Tipp (`onMarkerKlick`) wählt ohne Anflug, die Objektliste (`MarkerSuche` `onWaehlen`) mit Anflug. Weitere Aufrufer von `waehleObjekt` prüfen und je Weg begründet zuordnen. Seiten-Test grün
- [x] 2.3 e2e in `lagekarte-touch.spec.ts`: Zoom setzen, Marker antippen, danach sind `getZoom()` und Mitte unverändert und der Inspector ist offen. Listentreffer bei Zoom 17 behält 17, bei Zoom 12 wird auf 15 herangezoomt

## 3. Leiste bei grobem Zeiger zu (D3)

- [x] 3.1 `leisteSichtbar` (`pages/lagekarte/leistenWahl.ts`) nimmt `istBeruehrung`: Vorgabe `!istBeruehrung && (breit || !istSchmal)`, gemerkte Wahl und `erzwungen` gehen vor. Fälle in `leistenWahl.test.ts` ergänzen (Touch ab lg ohne Wahl → zu, Touch mit Wahl offen → offen, Touch und Auswahl → offen, fein ab lg → offen); Doc-Kommentar nachziehen
- [x] 3.2 `LagekartePage` reicht `istBeruehrung` aus `useViewport` durch; e2e (`hasTouch`, 1280 × 800, ohne gemerkte Wahl) zeigt die Leiste geschlossen und den Knopf „Leiste einblenden“, nach Marker-Tipp ist sie offen

## 4. Kartenknöpfe mit Wort (D1, D2)

- [x] 4.1 `kartenKnopfBreite(token)` in `KartenUeberlagerung.tsx` mit Unit-Test (≥ Kante, längstes Wort passt in `kompakt`, `komfortabel`, `handschuh`); `Kartenknopf` erhält die Prop `wort`, rendert Symbol und Wort untereinander und lässt `title` bei gesetztem Wort weg; Komponenten-Test: Wort sichtbar, `aria-label` unverändert, Zoom ohne Wort
- [x] 4.2 Wörter setzen: Norden, Position, Messen, Zeichnen, Leiste; alle Knöpfe des Blocks gleich breit; `fussStil` (`KartenFuss.tsx`) und `maxWidth` der linken Überlagerung rechnen mit `kartenKnopfBreite`. Test in `KartenFuss` bzw. Überlagerung grün
- [x] 4.3 Mitnutzer prüfen: `personen/BetroffeneKarte.tsx`, `geraet/GeraetAbschnittKarte.tsx` (gleiche Wörter, Fußkante); ihre Tests grün
- [x] 4.4 e2e `fokus-verdeckung.spec.ts`, `leisten-flaeche.spec.ts`, `lagekarte-smoke.spec.ts` bei 390 und 1024 px in `handschuh` grün (Knopfblock, Fuß und Überlagerung überschneiden sich nicht, jeder Knopf antippbar)

## 5. Regeln und Anwenderdoku

- [x] 5.1 `pages/lagekarte/AGENTS.md` fortschreiben: Einleitung (Leiste bei grobem Zeiger per Vorgabe zu), Kamera-Regel (Marker-Tipp ohne Anflug, Anflug nur heran), Knopfspalte (Wort unter dem Symbol, `kartenKnopfBreite` statt Kante); Verweise auf `kartenKnopfKante` per grep prüfen
- [x] 5.2 `docs/anwender/kapitel/lagekarte.md`: Knöpfe mit Wort, Leiste am Touch-Gerät, Marker-Tipp ohne Zoom; Bilder über den Bildlauf (`e2e/doku-bilder/lagekarte.bilder.ts`) neu, Wächter der Anwenderdoku grün

## 6. Review-Befunde (16.11.2026)

- [x] 6.1 Marker im Bild halten (D4, Entscheidung Ruben): `nachfuehrVersatz` in `kamera.ts` mit Unit-Test, `sichtZiel` aus `useKartenInteraktion`, `panBy` in `Kartenflaeche`; e2e „Marker am rechten Rand“ in `lagekarte-touch.spec.ts` (LLH-1751-Block) grün
- [x] 6.2 Anflug während eines Anflugs nimmt dessen Zielzoom (D5): `anflugZoom(aktuell, laufendesZiel)` mit Unit-Test, Ziel per Ref und laufender Nummer in `Kartenflaeche`
- [x] 6.3 Ansichtswechsel hält die Leiste offen (D6, Entscheidung Ruben): `zeigeLeiste()` im `onAnsichtWechsel`; Seiten-Tests „hält offen“ und „ohne Wechsel schließt“ grün
- [x] 6.4 Knopfbreite wird gemessen statt nachgerechnet: e2e „Wörter passen in die Kartenknöpfe“ (kompakt, handschuh) grün, Unit-Test pinnt den gemessenen Wert

## 7. Integration

- [x] 7.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu die e2e-Suiten aus 2.3, 3.2 und 4.4 lokal grün. Lokal (16.11.2026): `--nur schnell` und `--nur frontend` grün; die Rust-Suite passte nicht ins Plattenkontingent der Cloud-Sitzung, gefahren und grün sind `cargo test --lib` und die berührten Integrationstests, die volle Suite läuft auf `alpha`

## Workflow follow-up

- Review vor dem PR (Phase 4 des Orchestrators), dann `/opsx:archive` im selben Branch.
- Folgeaufgabe „Leere Zeitachse der Lagekarte“ über `zunder-task-anlegen`.
