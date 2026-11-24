# Lagekarte als GeoJSON und KMZ exportieren — Design

Stand: 24.11.2026 · Zunder LLH-2098 (Teil A von LLH-1196)
Zunder: https://zunder.rubeen.dev/#/aufgabe/k9tkgroujn207hq8kzyyelrw
Bezug: `docs/konzepte/2026-11-10-schnittstellen-ausbau.md` (Geodaten), gemeinsame ADR mit
`2026-11-24-qe5jrctd-fremdebenen-design.md`.

## Absicht

Stäbe, THW, Nachbarkreise und Feuerwehren tauschen Lagekarten heute als Screenshot oder Ausdruck.
Wer die Lage in Google Earth, QGIS oder dem GIS einer Behörde weiterführen will, braucht die
Zeichnungen als Geodaten: lagerichtig, mit Beschriftung und mit dem taktischen Zeichen.

## Ziele

- Ein Knopf exportiert, was die Lagekarte **gerade zeigt**, als GeoJSON (RFC 7946) oder als KMZ.
- Die KMZ öffnet in Google Earth und QGIS lagerichtig, mit Beschriftung und mit dem taktischen
  Zeichen als Symbol.
- GeoJSON trägt das Zeichen maschinenlesbar (`lfh:zeichen`), damit eine andere
  Lifeline-Hub-Instanz oder ein Werkzeug es wieder zeichnen kann, und Farben nach der
  simplestyle-Konvention, damit geojson.io, GitHub und QGIS-Plugins sie zeigen.
- Der Export geht auch ohne Netz und aus einem gesicherten Stand (Historienansicht).

## Nicht-Ziele

- Kein Export über die öffentliche API v1 und keine Route im Backend.
- Kein GPX (Fireboard). Das wird eine eigene Folgeaufgabe.
- Fachebenen (amtliche Quellen), Bild-Hintergründe, Fremdebenen und Messungen werden nicht
  exportiert.
- Kein Re-Import der eigenen Datei als eigene Zeichnung. Das ist „Objekt übernehmen“ und bleibt
  optional, später.

## Anti-Ziele

- **Keine personenbezogenen Daten in der Datei:** keine Betroffenen bzw. Personen-Marker, keine
  einzelnen Personal-Marker, keine Notizen, keine Abschnittsaufträge. Die Datei verlässt das
  System, Aufbewahrung und Schwärzung greifen dort nicht.
- Nicht still mehr exportieren, als zu sehen ist. Eine ausgeblendete Ebene bleibt draußen.

## Abgestimmt (Phase-1-Checkpoint, 24.11.2026)

- **Umfang:** sichtbare Ebenen mit Beschriftung (`label` bzw. Name). Notizen, Aufträge und
  Personen bleiben draußen, Fach- und Fremdebenen ebenso.
- **Ort:** Frontend.
- **Formatwahl:** „Google Earth (KMZ)“ und „GIS (GeoJSON)“ als Menüeinträge. Formatnamen stehen
  nur als Wahl da, nie als Erklärsatz (`frontend/AGENTS.md`, „Texte: zeigen statt erklären“).
- **Bibliothek:** `fflate` für die KMZ.

## Ansätze

1. **Im Client aus den geladenen Daten (gewählt).** `LagekartePage` hält `sichtbareMarker`,
   `kartenFlaechen`, `zonenFeatures` schon modulweise freigegeben bereit (`useLagekarteDaten.ts`).
   Nur der Client kennt die Zeichen (`markerZeichen`, `fachobjektZeichen`, Leseadapter der
   freien Zeichen) und kann sie als PNG rendern (`@einsatzzeichen/core` `renderCanvas`). Das
   geht ohne Netz und aus der Historienansicht, und es braucht keine Route.
2. **Im Backend über `KartenFeature` (`lagemonitor.rs`).** Verworfen: Der Sammelendpunkt
   trägt bewusst keine Beschriftung und keine Schäden, Fahrzeuge oder Einheiten, und im Backend
   gibt es keinen Zeichen-Renderer. Er müsste die Zeichenlogik des Clients nachbauen.
3. **Hybrid: GeoJSON im Server, KMZ im Client.** Verworfen: zwei Wege für dieselben Objekte, die
   auseinanderlaufen.

## Entwurf

### Was hineinkommt

Quelle ist die Menge, die die Karte gerade zeichnet: dieselben Arrays, die an `useLageplan`
gehen, also Sichtbarkeit (`LayerSichtbar`), Modulfreigabe, Fokus und Ansicht. In der
Historienansicht ist es der gezeigte Stand.

| `lfh:art` | Herkunft | Geometrie | `name` |
|---|---|---|---|
| `freies_zeichen` | freie Zeichen | Point | `label` |
| `zone` | Lage-Zonen ohne Gefahr | Polygon bzw. LineString; Kreis als Polygon mit 64 Ecken | `label` |
| `gefahrengebiet` | Gefahrenzonen | Polygon | `label`, sonst „Gefahrengebiet“ |
| `schaden` | Schaden-Marker | Point | Markertext |
| `uhs` | UHS | Point | Name |
| `betreuung` | Betreuungsstellen | Point | Name |
| `abschnitt` | Einsatzabschnitte | Polygon (Fläche) und Point (Marker) | Name |
| `fahrzeug` | Fahrzeuge mit Position | Point | Funkrufname bzw. Anzeigename |
| `einheit` | Einheiten mit Position | Point | Anzeigename |

Nicht hinein: Personen bzw. Betroffene, einzelne Personal-Marker (Kräfte gehen über Einheit
oder Fahrzeug), Notiz-, Auftrags- und Beschreibungsfelder, Fachebenen, Bilder, Messungen,
Suchnadel.

### Ein Zwischenmodell, zwei Schreiber

Reine Funktionen unter `frontend/src/pages/lagekarte/` (kein neues Verzeichnis unter
`frontend/src/`):

- `geoExport.ts`: `sammleExportObjekte(eingabe) → ExportObjekt[]`, mit `{art, name, geometrie
  (GeoJSON, [lon,lat], 6 Nachkommastellen), zeichen?: {schluessel, spec}, stil: {linie, fuellung,
  deckkraft, markerFarbe}}`. Die Farben kommen als Hex aus der `PALETTE` von
  `@einsatzzeichen/schema` bzw. aus `zonenStil`. Gefahrengebiete bekommen eine feste Exportfarbe
  je Warnstufe statt des Theme-Tokens (Tabelle in `geoExport.ts`, gleiche Töne wie das helle
  Theme).
- `geojsonSchreiben.ts`: `FeatureCollection` mit
  - **je Feature** `properties`: `name`, `lfh:art`, `lfh:zeichen` (die kanonische Spec, falls
    vorhanden), `lfh:kreis` (`{mitte:[lon,lat], radius_m}` bei Kreiszonen) und die simplestyle-
    Felder `marker-color`, `stroke`, `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity`;
  - **am Wurzelobjekt** `lfh:stand` (UTC, ADR-0012) und `lfh:quelle: "Lifeline Hub"`.
  - Medientyp `application/geo+json`, Endung `.geojson`.
- `kmlSchreiben.ts`: KML 2.2 mit
  - **`Document`**: `name` = Einsatzbezeichnung und Stand.
  - **`Style`** je Zeichenschlüssel: `IconStyle` mit `href` `files/<hash>.png`, `LabelStyle`,
    `LineStyle`/`PolyStyle` in `aabbggrr`.
  - **`Folder`** je `lfh:art`.
  - **`Placemark`**: `name`, `ExtendedData` mit `lfh:art` und `lfh:zeichen`, Geometrie mit
    `clampToGround`, Polygone mit `outerBoundaryIs`/`innerBoundaryIs`.
  - Alle Texte XML-escaped, keine `description` (Anti-Ziel Freitext).
- `kmzPacken.ts`: `fflate.zipSync`. `doc.kml` steht als erster Eintrag, gepackt, die PNGs ungepackt
  (`level: 0`). Medientyp `application/vnd.google-earth.kmz`.

### Zeichen als PNG

Je verschiedenem Zeichenschlüssel (`ez|<Spec>` aus `markerZeichen`) einmal
`renderCanvas` → `canvas.toBlob('image/png')`. Gerendert wird mit 64 px Kantenlänge im **hellen**
Theme (`frontend/src/pages/lagekarte/AGENTS.md`: dunkel nur mit Theme `dark`, nie selbst
einfärben). Vorher muss die Zeichenschrift geladen sein (README von `@einsatzzeichen/core`,
`TEXT_FONT_FAMILY_ATTR`). Der Dateiname ist ein kurzer Hash des Schlüssels. Objekte ohne Zeichen
(Zonen, Abschnittsflächen) bekommen keinen `IconStyle`.

### Bedienung

In „Weitere Aktionen zur Lagekarte“ (`NebenwegeImKopf`, `LagekartePage.tsx`) zwei Einträge
neben Druck und Anlage:

```
⋯  Weitere Aktionen zur Lagekarte
   Drucken …
   Als Anlage an …
   Exportieren: Google Earth (KMZ)
   Exportieren: GIS (GeoJSON)
```

Ein Klick erzeugt die Datei und speichert sie über `speichereDatei`. Der Dateiname kommt aus
einem erweiterten `exportDateiname`: Inhalt `lagekarte`, Endung als Parameter, also
`lagekarte-einsatz-42-2026-11-24-1405.kmz`. Ist nichts sichtbar, sind die Einträge gesperrt mit
dem Grund „Nichts eingeblendet“ sichtbar am Eintrag. Ein Fehler beim Rendern geht als
Seitenfehler an die Seite. Lesen genügt, also an kein Schreibrecht gebunden.

### Prüfungen

- **Einheitentests der reinen Funktionen:** Sammeln (ausgeblendete und personenbezogene Objekte
  fehlen, Freitexte fehlen, Kreis zu Polygon), GeoJSON (gültig nach RFC 7946: Ring geschlossen,
  `[lon,lat]`, keine Fremd-CRS), KML (Escaping, Farben `aabbggrr`, Struktur), KMZ (`doc.kml`
  zuerst, PNG-Einträge, mit `fflate.unzipSync` wieder lesbar).
- **Komponententest** für die Menüeinträge (gesperrt ohne Sichtbares, Aufruf von
  `speichereDatei`).
- **Akzeptanz Google Earth und QGIS:** Ruben öffnet eine Beispieldatei aus dem Dev-Stack. Das
  liegt außerhalb der Sitzung und kommt als Prüfpunkt in den PR.

### Doku und Regeln

- **Anwenderdoku:** Kapitel Lagekarte, Abschnitt „Lagekarte exportieren“ (Mitänderungsregel
  `docs/anwender/AGENTS.md`).
- **ADR:** die gemeinsame ADR mit den Fremdebenen. Sie hält fest, dass Geodaten das System aus dem
  Client verlassen und nur sichtbare, nicht personenbezogene Objekte enthalten.
- **Abhängigkeit:** `fflate` in `frontend/package.json` (MIT, ohne Abhängigkeiten).

## Dem Bauenden überlassen

- **Genauer Zuschnitt des Eingabetyps von `sammleExportObjekte`:** nah an dem, was `useLageplan`
  bekommt.
- **Hashfunktion für PNG-Namen:** etwa FNV-1a. Kryptografische Güte ist nicht nötig.
- **Exakte Farbwerte der Gefahrengebiete:** aus dem hellen Theme abgelesen.
