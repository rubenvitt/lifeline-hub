# Plan: Fachebene Copernicus EMS Rapid Mapping (LLH-1200)

Entwurf: `docs/superpowers/specs/2026-11-21-wqafyn8u-copernicus-ems-fachebene-design.md`
(freigegeben 21.11.2026) · Zunder: https://zunder.rubeen.dev/#/aufgabe/wqafyn8uobx1zzsuz1ps572q

Ausführung: `executing-plans` im Main-Loop. Die Aufgaben bauen aufeinander auf (Wire-Wörter
des Backends → Frontend), und Backend und Frontend teilen den Klassenvertrag. Jede Aufgabe
läuft per TDD: erst der rote Test, dann der Code.

## Festlegungen, die über den Entwurf hinaus nötig sind

- **Wire-Wörter `klasse`** (wie Hochwasser auf beiden Seiten gepinnt):
  - Gebiet und Ereignis: `gebiet`, `nicht_ausgewertet`, `beobachtet`, `max_ausdehnung`;
  - Wassertiefe: `tiefe_gering` (< 0,5 m), `tiefe_mittel` (0,5–1 m), `tiefe_hoch` (> 1 m);
  - Schäden: `zerstoert`, `beschaedigt`, `schaden_moeglich`, `kein_schaden`;
  - Rückfall: `unbekannt`.

  `art` bleibt wie im Entwurf.
- **Zeitpunkte** in den Feature-Properties (`aufnahme`, `geliefert`) als UTC im
  `zeit::FORMAT` (ADR-0012). `stand` des Umschlags ebenso.
- **Wartefrist** im kalten Pfad: 10 s über `liefere_geloest` (wie Energie; nach Review von 15 s gesenkt, der Client bricht nach 15 s ab); danach `offline`,
  der Abruf läuft weiter. Das Frontend nimmt `aufwaermPollMs` 15 s.
- **Hinweis bei `leer`** und die EMSR-Zeile stehen in der Zeile der Ebene im Ebenenbaum.

## Aufgaben

### 1. Testdaten aus dem echten Abruf
- [x] `src/karte/testdaten/copernicus/`: `liste.json` (gekürzt, enthält EMSR728, eine laufende
      und eine `sensitive`), `emsr728.json` (Gebiete 1 und 9, gekürzt), `ebene_tiefe.json`
      (floodDepthA Gebiet 1, wenige Features), `ebene_verkehr.json` (transportationL Gebiet 9).

### 2. Backend, reine Teile (`src/karte/copernicus.rs`)
- [x] WKT lesen: `POINT (lon lat)` → Punkt, `POLYGON ((…))` → Rechteck (Hülle).
- [x] Auswahl der Kandidaten: `n_products > 0`, Zeitfilter mit/ohne Archiv, 500 km zum Ausschnitt.
- [x] Gebiet schneidet Ausschnitt; `sensitive` fällt heraus.
- [x] Produktwahl je Gebiet und Art (Monitoring, Version, Status `F`, FEP nur ohne DEL).
- [x] Ebenenart aus dem Ebenennamen; unbekannte Arten bleiben draußen.
- [x] Klassen: Wassertiefe, Schadensgrad, Rückfall `unbekannt`.
- [x] Normalisierung zu Features mit allen Feldern; Gebietsumriss als Feature.
- [x] Lagerichtig: Überflutungsflächen von EMSR728 liegen im Umriss von Gebiet 1 (lon/lat).

### 3. Backend, Abruf und Route
- [x] Kern mit austauschbarem Holer: Liste → Details → Ebenen, Teil-Caches mit eigenen TTLs,
      Rückfall auf alten Teilstand, Obergrenze 40 Dateien (`gekuerzt`), fehlende Ebene
      (`unvollstaendig`), Liste fehlt → `None`.
- [x] `fetch_copernicus` mit `liefere_geloest`, Schlüssel je Raster-bbox und Archiv.
- [x] Route-Arm `copernicus` mit bbox-Pflicht und 3°-Grenze; Route-Tests (400).

### 4. Frontend, Vertrag und Ebene
- [x] `FachebeneQuelle` + `copernicus`; Query-Key mit bbox und Archiv; `ladeFachebene` mit
      `archiv`.
- [x] Klassenvertrag `copernicusKlasse` in `theme/statusFarben.ts`, Pin der Wire-Wörter.
- [x] `copernicusStil.ts`: Farbe und Radius bzw. Linienbreite je Klasse einbacken.
- [x] Ton `copernicus` in `tokens.ts` (hell/dunkel) und `FACHEBENE_TON`.
- [x] Eintrag in `FACHEBENEN` (Takt 10 min, Aufwärmen 15 s, veraltet 120 min, `minZoom`,
      `geltung`, `gemischteGeometrie`), `fachebeneKeys`, Auswahl-Vorgabe aus, Gruppe `satellit`.
- [x] TTL-Wächter kennt `COPERNICUS_TTL`.

### 5. Frontend, Abfrage und Ebenenbaum
- [x] `useFachebenen`: eigene `useQuery` mit bbox, Archiv, Takt und Aufwärmtakt; Spannen- und
      Zoomriegel wie Energie.
- [x] Archiv-Schalter in der Ebenenzeile, Zustand nur im Speicher.
- [x] Hinweis bei `leer`, EMSR-Nummern mit Aufnahme bei `ok`.

### 6. Frontend, Zeichnen
- [x] `fachebenenLayer.ts`: für `gemischteGeometrie` Flächenfarbe je Feature, Gebiet nur als
      gestrichelter Umriss, Linien- und Kreis-Layer mit Trefferzone; übrige Ebenen unverändert.

### 7. Frontend, Inspector
- [x] Zweig `CopernicusInhalt` mit Aktivierung, Gebiet, Produkt, Version, Aufnahme und Sensor,
      Lieferzeit, Klasse, Beschreibung, Link, Altersmarke über 24 h; Titel.

### 8. Doku
- [x] `docs/fachebenen-quellen.md`: Tabellen und Abschnitt.
- [x] `docs/anwender/kapitel/lagekarte.md`: Gruppe und Lesart.
- [x] Architektur: Kontextabgrenzung prüfen und nachziehen.

### 9. Abschluss
- [x] Folgeaufgaben in Zunder (COG LLH-2021, Altbestand vor 2023 LLH-2022).
- [x] `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Bündel einzeln; Rust in Portionen,
      weil der volle Testbau das Plattenkontingent der Cloud-Sitzung sprengt; Desktop-Hülle
      ohne gdk-3.0 im Container nicht baubar).
- [x] Bild der Änderung mit Live-Daten EMSR728.
- [x] PR gegen `alpha`: https://github.com/rubenvitt/lifeline-hub/pull/1558
