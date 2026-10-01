# Proposal

## Why

Die Modulseite „Wetter & Pegel“ (LFH-633) zeigt, welches Wetter kommt: Warnungen und eine
Vorhersage für 24 h. Welches Wetter **gerade** am Einsatzort herrscht, zeigt sie nicht.
Temperatur, Wind und Böen, Niederschlag der letzten Stunde und Sicht sind für Einsatzentscheidungen
der Ist-Stand. Beispiele sind Drehleiter und Wind, Glätte, Unterkühlung Betroffener oder ein Flug
der Drohne. Heute muss die Führung dafür eine fremde Seite öffnen. Ruben hat das Paneel am
01.10.2026 gewünscht (LFH-864).

## What Changes

- Der Wetter-Endpunkt `GET /api/einsaetze/{id}/wetter` liefert einen dritten Teil `aktuell`.
  Er enthält die **gemessenen** Werte der nächsten DWD-Wetterstation zum Einsatzort,
  mit eigenem Teilzustand (`ok | kein_ort | ausfall`) und eigenem Datenstand. Die Antwort wird
  nur erweitert, ist also nicht **BREAKING**.
- Quelle ist Bright Sky `/current_weather`. Die Wetterdaten kommen bereits von dort, eine neue
  Quelle kommt nicht hinzu.
- Die Modulseite bekommt ein Paneel „Aktuelle Bedingungen“ mit folgenden Angaben:
  - Messzeit und Station samt Entfernung;
  - Temperatur, Wind mit Richtung und Böen;
  - Niederschlag der letzten Stunde und Wetterlage;
  - Sicht, Bewölkung, Luftfeuchte, Taupunkt und Luftdruck.
- Werte, die die Quelle von einer **anderen** Station ergänzt, sind als solche benannt, samt
  Station und Entfernung.
- Ein fehlender Messwert erscheint als Strich, nie als 0. Eine zu alte Messung heißt
  „veraltet“, ab der Obergrenze „Stand unbekannt“. Ein Ausfall reißt Warnungen und Vorhersage
  nicht mit.
- Diese Change hebt das Non-Goal „Keine … Beobachtungsdaten“ aus LFH-633 für den Einsatzort-Punkt
  auf. Radar bleibt ausgeschlossen.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lage-wetter-pegel`: Eine neue Anforderung „Aktuelle Bedingungen am Einsatzort“ kommt hinzu.
  Die Anforderung „Datenstand und Quellausfall“ bekommt eine Zeile für den neuen Teil:
  „veraltet“ und „Stand unbekannt“ richten sich nach dem Alter der Messung.

## Impact

- **Backend:** `src/wetter/mod.rs` (DTOs, Enum der Wetterlage), `src/wetter/quelle.rs`
  (Auswertung `/current_weather`), `src/wetter/abruf.rs` (dritter Teil im SWR-Cache, Schlüssel
  `wetter-aktuell:<org>:<lat>,<lon>`), `src/api_doc.rs` (Schemas), neue Testdatei
  `src/wetter/testdaten/current_weather.json`.
- **Frontend:** `frontend/src/wetter/` (neues Paneel, Einordnung des Stands, Textbausteine),
  `frontend/src/pages/WetterPegelPage.tsx` (Raster, Seitenkopf-Datenstand),
  `frontend/src/api/types.ts`. Dazu kommen die Tests der Seite und `e2e/wetter-pegel.spec.ts`
  mit Querlauf, Trefflächen und Kontrast.
- **Typ-Codegen:** `scripts/check-typ-codegen.sh`, beide generierten Dateien werden
  mitcommittet.
- **Kein** Schema- oder Migrationswechsel, denn der Cache ist der vorhandene Nachschlage-Cache.
  Kein neues Recht und kein neues Modul, denn das Gate bleibt `EinsatzLesezugriff<WetterPegel>`.
- **Drittanbieter:** Je Ort und Organisation kommt höchstens ein weiterer Abruf alle 10 min
  bei Bright Sky hinzu. Er trägt nur die gerundete Koordinate.
