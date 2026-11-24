# Copernicus EMS: Aktivierungen vor 2023 (LLH-2022)

Stand: 24.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/pjfe442jcok05bez6zlaiofc ·
Folgeaufgabe aus LLH-1200 (Entwurf
`docs/superpowers/specs/2026-11-21-wqafyn8u-copernicus-ems-fachebene-design.md`, ADR-0079) ·
Abgestimmt: Ruben im Chat, 24.11.2026 (Bedarf ja, kleiner Katalog; ZIP zur Laufzeit; Filter
auf den Ausschnitt für alle Copernicus-Ebenen)

## Absicht

Die Fachebene Copernicus zeigt heute nur Aktivierungen ab EMSR656 (März 2023), weil die
öffentliche Liste und die Detail-Schnittstelle des Dashboards erst dort beginnen. Für Übungen
und für die Nachbereitung sind aber gerade die großen älteren Lagen wertvoll, allen voran das
Hochwasser im Ahrtal 2021 (EMSR517). Hinter dem bestehenden Schalter „Ältere Aktivierungen“
sollen deshalb auch ausgewählte Aktivierungen vor 2023 erscheinen, lagerichtig und mit
derselben Darstellung und demselben Inspector wie die neuen.

## Ziele

- EMSR517 erscheint mit „Ältere Aktivierungen“ lagerichtig über dem Ahrtal (Abnahme an AOI15
  Bad Neuenahr-Ahrweiler, Grading Monit01 v3) und in den übrigen Gebieten der Aktivierung.
- Die Features haben dieselbe Normalform wie bei den neuen Aktivierungen (`art`, `klasse`,
  Herkunftsfelder, Gebietsumriss mit `unvollstaendig` und `gekuerzt`). Frontend, Farben und
  Inspector brauchen dafür keine eigene Logik.
- Weitere Altaktivierungen lassen sich durch einen Eintrag im Katalog ergänzen, ohne Code.
- Große Gebiete passen in die Antwort: Jede Copernicus-Ebene liefert nur noch Features, die den
  Kartenausschnitt schneiden (gilt für alte und neue Aktivierungen).

## Nicht-Ziele

- **Kein automatisches Finden aller Altaktivierungen** über die Seiten des Portals. Das Portal
  sagt keine Stabilität zu, und der Bedarf ist eine Handvoll großer Lagen.
- **Kein Shapefile-Parser.** Die Vector Packages enthalten je Ebene schon eine GeoJSON-Datei in
  WGS84 (geprüft an EMSR517 AOI01, AOI07, AOI15; die `.prj` nennt `GCS_WGS_1984`). Anders als
  in der Aufgabe vermutet, gibt es also nichts zu übersetzen.
- **Keine Daten im Repo**, außer kleinen, gekürzten Testdaten.
- Keine Rasterbilder, keine PDFs, keine KMZ.
- Kein neuer Schalter und kein neues Frontend-Bedienelement.

## Anti-Ziele

- Eine Altaktivierung darf nie ohne „Ältere Aktivierungen“ erscheinen. Eine Flut von 2021 in
  einer aktuellen Lage wäre irreführend.
- Ein kaputtes oder manipuliertes ZIP darf weder Speicher noch Platte sprengen
  (ZIP-Bombenschutz) und darf nicht von beliebigen Hosts kommen.
- Referenzdaten (Gebäude und Straßen ohne Schadensklasse) dürfen nicht als „Schaden unbekannt“
  über die Karte gestreut werden.

## Ansätze

1. **Kuratierter Katalog im Repo, ZIP zur Laufzeit (gewählt).** Der Katalog nennt je
   Aktivierung die Gebiete mit Umrissrechteck und die Produkte mit ZIP-Adresse. Erst wenn der
   Ausschnitt ein Gebiet schneidet und „Ältere Aktivierungen“ an ist, lädt das Backend das ZIP,
   liest daraus nur die gebrauchten JSON-Dateien und speichert das Ergebnis. Das Repo bleibt
   klein, und neue Einträge kosten nur Katalogzeilen.
2. Vorverarbeitete Ebenen als GeoJSON im Repo. Das ginge ohne Uplink, bläht das Repo aber um
   geschätzt 50 bis 150 MB auf, und jede weitere Aktivierung kostet mehr. Verworfen.
3. Live über die Portalseiten (`mapping.emergency.copernicus.eu/activations/EMSRnnn/`): HTML
   ohne Stabilitätszusage auslesen, große Downloads, am meisten Code. Verworfen.
4. Import per Hochladen durch eine Admin-Person. Das wäre ein anderer Bedienweg und erfüllt das
   Akzeptanzkriterium nicht. Verworfen.

**Ausschnittfilter:** für alle Copernicus-Ebenen (gewählt). Verworfen wurden der Filter nur für
alte Aktivierungen (zwei Regeln nebeneinander) und gar kein Filter (das Ahrtal käme immer mit
„gekürzt“, weil AOI15 allein rund 9 MB Gebäude und Straßen hat und die Grenze bei 6 MiB liegt).

## Die Quelle

Geprüft am 24.11.2026:

| Zweck | Ort | Inhalt |
| --- | --- | --- |
| Übersicht (nur zum Pflegen des Katalogs) | `https://mapping.emergency.copernicus.eu/activations/EMSR517/` | HTML: Gebiete, Produkte, Lieferzeit, Links auf PDF und ZIP |
| Vector Package | `https://cems-mapping-website.s3.eu-west-1.amazonaws.com/static/activations/EMSR517/EMSR517_AOI15_GRA_MONIT01_r1_RTP01_v3_vector.zip` | ZIP, 1 bis 7 MB gepackt, entpackt bis 26 MB. Je Ebene `.shp/.dbf/.shx/.prj`, `.json` (GeoJSON, WGS84), `.kmz`, `.sld`, `.xml`, dazu `summaryTable.xlsx` |

Dateinamen im ZIP: `EMSR517_AOI15_GRA_MONIT01_<ebene><A|L|P>_r1_v3.json`; bei Produkten heißt
der Teil `PRODUCT` statt `MONIT01`. Gebietsumriss: `…_areaOfInterestA_…json` (ein Polygon,
`locality` = Gebietsname). Felder wie bei den neuen Ebenen: `damage_gra`, `obj_desc`, `info`,
`notation`. Lizenz und Quellenangabe wie bisher.

EMSR517 hat 17 Gebiete und 27 Produkte (DEL Product und Monit01 für AOI01 bis 06, GRA für AOI07
bis 21). Die Daten liegen auf einem anderen S3-Host als die neuen Ebenen
(`rapidmapping-viewer…`), der Host muss für den Betrieb erreichbar sein.

## Entwurf

### Katalog: `src/karte/copernicus_altbestand.json`

Eine kleine JSON-Datei, per `include_str!` eingebunden und beim Start (und in einem Test)
geprüft. Je Aktivierung:

```json
{
  "code": "EMSR517",
  "name": "Flood in Western Germany",
  "kategorie": "Flood",
  "gebiete": [
    {
      "nummer": 15,
      "name": "Bad Neuenahr-Ahrweiler",
      "huelle": [6.773, 50.367, 7.286, 50.569],
      "produkte": [
        { "typ": "GRA", "monitoring": 1, "version": 3,
          "geliefert": "2021-08-11T…Z",
          "zip": "https://cems-mapping-website.s3.eu-west-1.amazonaws.com/static/activations/EMSR517/EMSR517_AOI15_GRA_MONIT01_r1_RTP01_v3_vector.zip" }
      ]
    }
  ]
}
```

- `huelle` (west, süd, ost, nord) dient der Vorauswahl, damit kein ZIP ohne Treffer geladen
  wird. Den genauen Umriss liefert das ZIP.
- `geliefert` stammt von der Portalseite. Eine Aufnahmezeit nennt das ZIP nicht maschinenlesbar
  (nur in `source.dbf`), sie fehlt deshalb. `stand` ist dann die jüngste Lieferzeit.
  Der Inspector zeigt „Geliefert“, und die fehlende Aufnahme lässt er weg, wie heute schon bei
  Produkten ohne Bilder.
- Jede `zip`-Adresse muss mit dem festen Präfix
  `https://cems-mapping-website.s3.eu-west-1.amazonaws.com/static/activations/` beginnen; der
  Test prüft das für den ganzen Katalog.
- Inhalt zum Start: EMSR517 vollständig (alle 17 Gebiete, alle Produkte). Weitere deutsche
  Altaktivierungen sind eine eigene Entscheidung und nicht Teil dieser Aufgabe.
- Einen Generator gibt es nicht; die Einträge werden einmal aus der Portalseite übertragen
  (Gebietsrechteck aus `areaOfInterestA.json`). Wie das geht, steht in
  `docs/fachebenen-quellen.md`.

### Einbindung in `build_antwort`

- Mit `archiv` werden die Katalogeinträge zu `Details` mit `Gebiet` und `Produkt` wie bei der
  neuen Schnittstelle. Die Produkte tragen statt Ebenen-URLs die ZIP-Adresse. Ohne `archiv`
  bleibt der Katalog unberührt.
- Die Auswahl ist dieselbe: Gebiet, dessen `huelle` den Ausschnitt schneidet;
  `select_produkte` (jüngster Stand je Produktart, FEP gibt es im Altbestand nicht).
- Eine Aktivierung, deren Code die neue Liste schon führt, kommt nicht aus dem Katalog (sonst
  doppelt). Für EMSR517 trifft das nicht zu, die Regel schützt künftige Einträge.
- Ein Produkt aus dem Katalog gilt für `select_produkte` als „mit Ebenen“, denn sein ZIP ist
  die Ebenenquelle. Welche Ebenen darin stehen, erfährt der Weg erst nach dem Laden; der Katalog
  führt sie nicht. *(Meine Entscheidung: weniger Handarbeit am Katalog.)*
- **Obergrenzen:** Die 6 MiB je Antwort gelten gemeinsam für alte und neue Features. Für ZIPs
  gilt eine eigene Grenze von höchstens 6 ZIPs je Antwort (`MAX_ZIPS`), gezählt beim Planen der
  Abrufe wie die 40 Ebenen-Dateien. Darüber trägt das Gebiet `gekuerzt`. Bei Mindest-Zoom 10
  schneidet ein Ausschnitt selten mehr als zwei oder drei Gebiete. *(Meine Entscheidung: die Zahl
  ist vor dem Laden bekannt, und ein ZIP kostet bis 7 MB Download.)*
- **Umriss:** Der genaue Umriss kommt aus `areaOfInterestA.json` des ZIPs, und zwar aus dem
  gewählten Produkt mit dem jüngsten Stand (höchste Monitoring-Nummer, dann Version; bei AOI01
  bis 06 also Monit01). Fehlt das ZIP oder ist es kaputt, zeigt das Gebiet das Rechteck `huelle`
  als Umriss und trägt `unvollstaendig`. *(Meine Entscheidung.)*
- **Zeit, die zählt:** Wo `stand` und `gebiet_feature` heute die jüngste `aufnahme` nehmen,
  zählt künftig `aufnahme`, ersatzweise `geliefert`. Das gilt in gemischten Antworten genauso.
  Neue Aktivierungen haben immer eine Aufnahme; für sie ändert sich nichts. Die Zeile „`stand` =
  jüngste Aufnahme“ in `docs/fachebenen-quellen.md` bekommt den Zusatz „ersatzweise Lieferung“.
  *(Meine Entscheidung.)*

### ZIP lesen: `src/karte/copernicus_zip.rs` (Arbeitstitel)

- **Abruf:** `http_begrenzt` mit eigenem Deckel 16 MiB gepackt (größtes geprüftes ZIP 7,1 MB),
  nur vom festen Präfix oben; eine Weiterleitung auf einen anderen Host scheitert.
- **ZIP-Bombenschutz** nach `src/abloesung/schichtplan/uebernahme/datei.rs`
  (`pruefe_entpackt`): vor dem Entpacken die angegebenen Größen der gebrauchten Einträge
  summieren und über 64 MiB ablehnen. Zusätzlich jeden Eintrag mit `take(grenze + 1)` lesen,
  denn die Größe im Verzeichnis kann lügen. Höchstens 200 Einträge im Verzeichnis.
- **Gebrauchte Einträge:** nur `*.json` im Wurzelverzeichnis, deren Ebene bekannt ist
  (`areaOfInterest` und die sechs Ebenenarten), kein Pfad mit `/` oder `..`.
- **Ebenenart aus dem Dateinamen:** `parse_ebenen_art` sucht heute den Teil vor `v<n>`. Im
  Altbestand steht dazwischen `r1` (`…_builtUpP_r1_v3.json`). Die Funktion überspringt künftig
  einen Teil `r<n>`; der bestehende Test mit `…_v2_VT` bleibt grün.
- **Welche Ebenen aus welchem Produkt:** `observedEvent`, `floodDepth`, `maximumFloodExtent`
  und `notAnalysed` aus jedem Produkt; `builtUp` und `transportation` nur aus GRA. In DEL
  sind Gebäude und Straßen Referenzdaten ohne `damage_gra` (geprüft an AOI01: 915 Gebäude,
  7 417 Straßen, keine mit Schadensklasse). Die übrigen Ebenen (`hydrography`,
  `naturalLandUse`, `facilities`, `imageFootprint`) fallen weg, wie bei den neuen.
- **Ergebnis:** `{ "umriss": <Polygon>, "ebenen": [{ "art": "...", "fc": <FeatureCollection> }] }`.
  Es wird unter `copernicus-teil:zip:<url>` mit `COPERNICUS_EBENE_TTL` (24 h) gespeichert, wie
  eine Ebene heute. Damit gilt auch das 48-h-Weiterleben bei Ausfall.
  Offen für den Plan: Speichert der Cache 10 MB JSON je Gebiet gut? Falls nicht, wird vor dem
  Speichern auf die Ebenen und Felder gekürzt, die `normalize_ebene` liest.
- Ein ZIP, das fehlt, kaputt ist oder die Grenzen reißt, macht das Gebiet `unvollstaendig`,
  wie eine fehlende Ebene heute. Die übrigen Gebiete bleiben.

### Ausschnittfilter (alle Copernicus-Ebenen)

- In `normalize_ebene` fällt jedes Feature weg, dessen Rechteck (aus der Geometrie berechnet,
  `bounding_box`) den angefragten Ausschnitt nicht schneidet. Der Gebietsumriss bleibt immer.
- Die 6-MiB-Grenze zählt danach; `gekuerzt` kommt also nur noch, wenn schon der Ausschnitt zu
  voll ist. Die Ebenenzeile sagt dann weiter „weiter hineinzoomen“, und das hilft jetzt auch.
- Gefiltert wird gegen den Ausschnitt, auf den der Cache-Schlüssel rundet, nach außen erweitert.
  Sonst würde eine gespeicherte Antwort auf den Ausschnitt zugeschnitten, der zuerst gefragt hat.
  Die Teilstände (Ebene, ZIP) bleiben ungefiltert und werden für jeden Ausschnitt
  wiederverwendet. *(Meine Entscheidung.)*

### Abruf der Bytes

`fetch` liefert heute JSON. Für ZIPs kommt ein zweiter Abrufer für Bytes dazu (im Betrieb
`http_begrenzt`, in Tests ein Stub). Weiterleitungen auf andere Hosts sperrt eine eigene
Redirect-Regel. *(Meine Entscheidung.)*

### Frontend

- Kein neuer Code für die Darstellung. Der Text „ab 2023“ in `pages/lagekarte/fachebenen.ts`
  (`geltung`) wird angepasst, etwa „nur wo Copernicus aktiviert wurde; vor 2023 nur
  ausgewählte“. Der genaue Wortlaut steht im Plan.

### Doku und Entscheidung

- `docs/fachebenen-quellen.md`: Tabellenzeile und Abschnitt „Copernicus EMS“ um den Katalog, den
  zweiten Host, das Pflegen eines Eintrags und den Ausschnittfilter ergänzen; „Nicht angebunden“
  anpassen.
- Neue ADR (E1): „Copernicus-Altaktivierungen kommen aus einem kuratierten Katalog mit
  Vector Packages zur Laufzeit“. Sie verweist auf ADR-0079 und legt den Ausschnittfilter fest.
  Die Prüfung der ADR ist ein Test, der den Katalog liest (Präfix, Pflichtfelder, keine
  Doppelung).
- Anwenderdoku: nur, wenn das Kapitel zur Lagekarte die Grenze „ab 2023“ nennt.

## Tests und Abnahme

- Testdaten: ein kleines, echtes ZIP aus EMSR517 AOI15, gekürzt auf wenige Features je Ebene
  (unter 100 KB), unter `src/karte/testdaten/`.
- Unit: Katalog lesen; `parse_ebenen_art` mit `r1`; ZIP mit Bombe (große angegebene Größe;
  lügende Größe), mit Eintrag außerhalb der Wurzel, mit fremdem Host; DEL ohne Schadensebenen;
  Ausschnittfilter (Feature außerhalb fällt weg, Umriss bleibt).
- `build_antwort` mit Stub: Ahrtal-Ausschnitt mit `archiv` liefert EMSR517 AOI15 mit Gebäuden
  und Straßen; ohne `archiv` kein ZIP-Abruf.
- Abnahme: Bild der Lagekarte über Bad Neuenahr-Ahrweiler mit echten Daten, „Ältere
  Aktivierungen“ an, Inspector auf einem zerstörten Gebäude.

## Dem Bauenden überlassen

- Modul- und Funktionsnamen (Regel: Fachbegriffe deutsch, Technik englisch).
- Ob der Katalog als `Details` direkt oder über einen kleinen Adapter in den bestehenden Weg
  geht, solange `select_produkte`, `normalize_ebene` und `gebiet_feature` gemeinsam bleiben.
- Die genaue Form des gespeicherten ZIP-Teilstands (siehe offene Frage oben).
