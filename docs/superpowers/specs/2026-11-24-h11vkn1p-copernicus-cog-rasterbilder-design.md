# Copernicus EMS: Rasterbilder (COG) als Kachelebene (LLH-2021)

Stand: 24.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/h11vkn1p4qkab8kkwq16ugvn ·
Vorgänger: LLH-1200 (`2026-11-21-wqafyn8u-copernicus-ems-fachebene-design.md`, ADR-0079) ·
Abgestimmt: Ruben im Chat, 24.11.2026 (Phase-1-Checkpoint, alle drei Empfehlungen gewählt)

## Absicht

Die Fachebene Copernicus zeigt die ausgewerteten Flächen: Wasser, Tiefe, Schäden. Wer eine Fläche
bewertet, will oft das Bild dahinter sehen: Ist das wirklich Wasser? Wie sieht die Straße aus?
Copernicus liefert zu optischen Produkten das orthorektifizierte Satellitenbild als Cloud Optimized
GeoTIFF (COG). Dieses Bild soll als eigene Rasterebene unter den Flächen liegen. Sensor und
Aufnahmezeit stehen daneben, denn ein Bild ist Stunden bis Tage alt.

## Was die Quelle liefert (gemessen am 24.11.2026)

- Die Details einer Aktivierung (`public-activations/?code=…`) nennen je Produkt in `layers[]`
  Einträge `{ "name": "EMSR728/AOI01/DEL_MONIT04/EMSR728_AOI01_DEL_MONIT04_GEOEYE1_20240608_1053_ORTHO.tif",
  "format": "cog" }`. `name` ist ein Pfad unter `https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com/`
  (`EBENEN_BASIS`), ohne `json`-Feld.
- Der Dateiname (letztes Pfadsegment) steht genauso in `images[].fileName` desselben Produkts.
  Daraus kommen `sensorName`, `sensorType` und `acquisitionTime`. Ein Produkt kann zwei Bilder
  haben (Beispiel: GeoEye-1 und Pleiades in DEL_MONIT04).
- SAR-Produkte (Sentinel-1, COSMO-SkyMed) haben in den Testdaten kein COG, nur optische.
- Das gemessene Bild (`…GEOEYE1_20240608_1053_ORTHO.tif`, 131 MB):
  - klassisches TIFF (kein BigTIFF), little-endian;
  - EPSG:3857 (GeoKey 3072, „WGS 84 / Pseudo-Mercator“), 4 m je Pixel, ModelTiepoint und
    ModelPixelScale gesetzt, keine Rotation;
  - RGB, 8 Bit je Kanal, Deflate (Compression 8) mit horizontalem Prädiktor (Predictor 2),
    Planarconfig 1;
  - Kacheln 512 × 512, GDAL_NODATA 0, Vollauflösung 11 447 × 8 594 px, dazu 5 Übersichten
    (jeweils halbe Größe);
  - S3 beantwortet `Range` mit 206, schickt ETag und Last-Modified, aber keinen CORS-Kopf.

## Ziele

- In der Gruppe „Satellitenauswertung“ eine zweite Ebene **„Copernicus-Satellitenbilder“**
  (`copernicus_bilder`), voreingestellt aus.
- Gezeigt werden genau die COGs der Produkte, deren Flächen die Vektorebene `copernicus` für
  denselben Ausschnitt zeigt (gleiche Auswahl, gleiche Produktwahl, gleicher Archiv-Schalter).
- Die Bilder liegen **über der Grundkarte und unter allen Fachebenen und Lagezeichen**. Eine
  Deckkraft lässt sich in der Ebenenzeile einstellen.
- Je Bild nennt die Ebenenzeile EMSR-Nummer, Gebiet, Sensor und Aufnahmezeit als DTG. Die Marke
  „Satellitenaufnahme vom <DTG>“ steht in der Achtung-Textfarbe, wenn die Aufnahme älter als
  24 h ist, wie im Inspector der Vektorebene.
- Kacheln kommen nur vom eigenen Server. Der Browser spricht nie mit S3, auch Lagemonitor und
  gekoppelte Geräte nicht.
- Einmal geladene Kacheln liegen im Kachel-Cache des Servers und gehen auch hinaus, wenn S3
  nicht erreichbar ist. „Ohne Netz“ heißt hier: der **Server** erreicht die Quelle nicht. Ist der
  Browser selbst offline (LFH-723), bleibt die Ebene leer wie jede Fachebene; sie kommt nicht in
  `LAGEBILD_OFFLINE` (meine Festlegung, gleich wie die übrigen Fachebenen).
- Abnahme an **EMSR728, Gebiet 1 (Stuttgart)**: Das GeoEye-Bild vom 08.06.2024 liegt lagerichtig
  unter den Überflutungsflächen. Belegt wird das durch einen Test der Kachelmathematik gegen die
  Georeferenz des echten Kopfes und durch ein Bild mit Live-Daten.

## Nicht-Ziele

- **Kein Browser-COG (geotiff.js, maplibre-cog-protocol).** Verworfen, siehe Ansätze.
- **Keine Umprojektion.** Ein COG, das nicht in EPSG:3857 vorliegt oder rotiert ist, wird nicht
  gezeigt, sondern mit „nicht darstellbar“ gelistet. Ein Projektions-Crate (proj) kommt nicht dazu.
- **Keine Bilder älterer Produkte.** Kein Zeitvergleich, keine Bildauswahl je Monitoring; das
  wäre eine Folgeaufgabe.
- **Kein Klick auf das Bild.** Die Rasterebene ist keine Klickebene, sie bekommt keine Rolle in
  `ordneKlickebene`. Die Herkunft steht in der Ebenenzeile, nicht im Inspector.
- Keine Vorab-Kachelung ganzer Bilder und kein Download für die Offline-Regionen.
- Kein neuer Adapter-Rahmen (wie LLH-1200, ADR-0079).

## Ansätze

1. **Serverseitig kacheln (gewählt).** Das Backend liest per HTTP-Range nur den Kopf und die
   Kacheln der passenden Übersicht, rechnet daraus eine 256-px-PNG-Kachel `z/x/y` und legt sie
   in den Kachel-Cache. Pro: kein CORS, kein fremder Host am Client, Cache und Offline wie bei
   jeder Kachel, SSRF-Schutz an einer Stelle. Contra: eigener kleiner TIFF-Leser und
   Rechenzeit auf dem Server.
2. **COG-Protokoll im Browser** (geotiff.js über `addProtocol`). Verworfen: S3 schickt keinen
   CORS-Kopf, der Browser darf die Datei also gar nicht lesen. Außerdem riefe jeder Client direkt
   AWS auf, am Proxy und am Cache vorbei, und auf gekoppelten Geräten ohne Internet ginge nichts.
3. **Vorgefertigte Kacheln der Quelle.** Verworfen: Eine stabile, dokumentierte Kachel-URL ist
   nicht bekannt. Das Viewer-Backend ist ein Dashboard-Pfad ohne Zusage, wie schon die Details.

**Bildauswahl:** nur die Bilder des gezeigten Produkts (gewählt). Verworfen: alle Bilder aller
Produkte, das jüngste oben. Bild und Fläche passten dann zeitlich nicht zusammen, und durch die
Lücken des jüngsten schimmerten ältere Aufnahmen.

**Ebenenfolge:** unter allen Fachebenen (gewählt). Verworfen: nur unter den Copernicus-Flächen,
aber über den übrigen Fachebenen. Ein großflächiges Bild verdeckte dann KRITIS-, Pegel- und
Warnflächen.

## Entwurf

### Backend

Neues Modul `src/karte/cog.rs` für das reine Lesen und Kacheln eines COG, ohne Copernicus-Wissen.
Die Copernicus-Teile kommen nach `src/karte/copernicus.rs`. Die Datei hat 1 675 Zeilen; wird sie
zu groß, darf der Builder ein Untermodul `copernicus/bilder.rs` anlegen.

**1. Bilder aus den Details lesen** (`copernicus.rs`)

- `Produkt` bekommt `bilder: Vec<Bild>` mit `pfad` (S3-Pfad aus `layers[].name`, `format ==
  "cog"`), `sensor`, `sensor_art` (`optical`/`sar`) und `aufnahme`. Die Werte kommen aus dem
  `images[]`-Eintrag mit gleichem `fileName`; fehlt er, bleiben Sensor und Aufnahme leer.
- Pfadprüfung: relativ, ohne `..`, ohne `//`, ohne Schema, endet auf `.tif`; die URL ist immer
  `EBENEN_BASIS + pfad`. Ein Pfad, der durchfällt, wird übersprungen.
- `select_produkte` bleibt die eine Stelle für die Produktwahl. Achtung: Sie filtert heute auf
  `!p.ebenen.is_empty()`. Für die Bilder gilt dieselbe Auswahl, also nur Bilder der gewählten
  Produkte. Ein Produkt mit Bild, aber ohne Vektorebene, bleibt deshalb wie heute draußen.

**2. Liste der Bilder:** `GET /api/map/overlays/copernicus/images?bbox=…[&archiv=1]`

- Gleiche `bbox`-Prüfung (`check_bbox`, Pflicht, höchstens 3°) und gleiche Auswahlkette wie die
  Vektorebene. Die gemeinsame Kette (Liste → Kandidaten → Details → Gebiete im Ausschnitt →
  `select_produkte`) wird so herausgezogen, dass beide Antworten sie nutzen und die
  Teilstand-Caches (`copernicus-teil:…`) teilen. Doppelte Abrufe darf es nicht geben.
- Antwort im Umschlag `FachebeneAntwort` mit `quelle: "copernicus_bilder"`; Status `ok`, `leer`
  oder `offline` wie bei der Vektorebene. Als `daten` dient eine FeatureCollection: je Bild ein
  Feature mit dem Bildumriss (Rechteck aus der Georeferenz, EPSG:4326) als Polygon und den Feldern
  `bild` (Kennung, siehe unten), `emsr`, `aktivierung`, `gebiet`, `produkt`, `monitoring`,
  `version`, `sensor`, `aufnahme`, `min_zoom`, `max_zoom`, `bounds` ([w, s, o, n]) und
  `darstellbar` (bool). So bleibt der Umschlag unverändert, und es entsteht kein neuer
  Response-Typ. Die neuen Feldnamen folgen der Sprache der bestehenden Copernicus-Features
  (deutsch); das ist die Regel „ein neues Feld in einem bestehenden Typ folgt dessen Sprache“.
- Umriss, Zoomgrenzen und `darstellbar` kommen aus dem COG-Kopf (unten). Den Kopf lädt erst die
  Liste: höchstens 6 gleichzeitig (`PARALLEL`), höchstens 20 Bilder je Antwort (`MAX_BILDER`, mit
  `gekuerzt` am Gebiet wie bei den Ebenen). Ein Kopf, der nicht lädt, macht die Antwort
  unvollständig: Sie wird ausgeliefert, aber nicht gespeichert, wie bei `build_antwort`.
- **Kalt:** Die Bilderliste läuft wie die Vektorebene über `liefere_geloest` mit
  `COPERNICUS_WARTE`. Reicht die Zeit kalt nicht für die Köpfe, ist die erste Antwort `offline`;
  der Lauf geht weiter und füllt die Caches, und der nächste Poll bzw. der Aufwärmtakt im
  Frontend zeigt die Bilder (meine Festlegung, keine eigene Wartezeit).
- **Doppelte Abrufe:** Gemeint ist, dass beide Antworten dieselben Teilstand-Schlüssel nutzen.
  Fragen beide Ebenen kalt im selben Augenblick, dürfen Liste und Details einmal doppelt laden;
  eine Bündelung je Teilstand baut dieser Schritt nicht (meine Festlegung).
- `stand` ist die jüngste `aufnahme`. Cache-Schlüssel `bbox.cache_key_mit("copernicus-bilder")`
  bzw. `copernicus-bilder-archiv`, TTL `COPERNICUS_TTL`.
- **Kennung `bild`:** die ersten 16 Hex-Zeichen von SHA-256 über den Pfad. Beim Bauen der Liste
  schreibt der Server den Eintrag `cog-kopf:<kennung>` → `{ pfad, kopf }` in den **Kachel-Cache**
  (`schreibe_eintrag`, unten). Bewusst nicht in `fachebenen_cache`, denn der räumt beim Schreiben
  alles weg, was älter als etwa 48 h ist (`cache.rs`), und das Bild bliebe danach unerreichbar
  (meine Festlegung). Die Kachelroute nimmt nur diese Kennung an, nie einen Pfad oder eine URL.
- Die Route kommt in `routes/karte.rs` vor den generischen Arm `/api/map/overlays/{quelle}`, mit
  der Anmeldung und den Rechten der übrigen Fachebenen-Routen. Wächter Schritt 14
  (`check-api-routen.sh`): `images` steht im Glossar.

**3. Kacheln:** `GET /api/map/overlays/copernicus/images/{bild}/{z}/{x}/{y}`

- Reihenfolge der Prüfungen: Form von `bild` (16 Hex-Zeichen, sonst 404) und `z/x/y`
  (`proxy::kachel_koordinate_gueltig`, sonst 400); dann der Kachel-Cache, ein Treffer geht ohne
  weitere Prüfung hinaus; erst bei einem Fehltreffer der Eintrag `cog-kopf:<kennung>` (fehlt er:
  404). Liegt die Kachel außerhalb von `bounds` oder
  unter `min_zoom`, ist die Antwort 204 ohne Inhalt; MapLibre zeichnet dann nichts.
- Antwort `image/png`, RGBA, 256 × 256; Nodata und Pixel außerhalb des Bildes sind durchsichtig.
  `Cache-Control: public, max-age=86400, immutable`. Der Pfad enthält Produkt und Version, das
  Bild ändert sich also nicht.
- Ablauf bei einem Fehltreffer (Kachelschlüssel `cog:<kennung>/<z>/<x>/<y>`): Kopf aus dem Eintrag nehmen, passende Übersicht wählen, die betroffenen
  512er-Quellkacheln per Range laden, entpacken, auf die Zielkachel abtasten, als PNG kodieren und
  in den Kachel-Cache legen. Ist S3 nicht erreichbar und die Kachel nicht im Cache, kommt 502;
  MapLibre lässt die Kachel dann leer.
- **Übersichtswahl:** die kleinste Stufe, deren Pixelgröße höchstens die Pixelgröße der
  Zielkachel ist (Web-Mercator-Meter je Pixel = 2πR / (256 · 2^z)). Ist auch die Vollauflösung
  gröber, dann die Vollauflösung. `max_zoom` ist der kleinste Zoom, bei dem die Zielkachel feiner
  als die Vollauflösung wäre; darüber vergrößert MapLibre selbst (`maxzoom` der Quelle). `min_zoom`
  ist der Zoom, ab dem das Bild auf der Karte mindestens 64 px breit ist, wenigstens aber
  `BBOX_MIN_ZOOM` des Frontends.
- **Abtastung:** nächster Nachbar. Weil Quelle und Ziel beide in EPSG:3857 liegen, ist die
  Abbildung je Achse affin, eine Umprojektion braucht es nicht. Bilinear ist die Wahl des
  Builders, falls Nächster-Nachbar sichtbar flimmert.
- **Grenzen:** Kopf höchstens 1 MiB; Quellkachel höchstens 2 MiB komprimiert und 512 × 512 ×
  Kanäle entpackt; höchstens 4 Quellkacheln je Zielkachel (bei richtiger Übersichtswahl reichen
  immer 4). Jeder S3-Abruf belegt einen Platz von `proxy::abruf_platz`; gleichzeitige Misses auf
  dieselbe Zielkachel teilen sich einen Lauf wie in `tile_cache` (LFH-930). Das Entpacken läuft in
  `spawn_blocking`.
- **Client:** `ausgehend::client_builder(Zweck::Lagekarte)`; die URL ist immer
  `EBENEN_BASIS + pfad`, ein fester Host. Weiterleitungen sind aus. Wird das in diesem Client
  nicht schon so gehandhabt, folgt der Builder `proxy_client` (pinnender Resolver, Redirect-Policy).

**4. COG lesen** (`src/karte/cog.rs`, rein und ohne Netz testbar)

- `parse_kopf(bytes) -> Result<Kopf, KopfFehler>`: klassisches TIFF und BigTIFF, beide
  Bytereihenfolgen. Gelesen werden alle IFDs (Vollbild, Übersichten), je IFD Breite, Höhe,
  Kachelgröße, `TileOffsets`/`TileByteCounts`, Compression, Predictor, SamplesPerPixel,
  BitsPerSample, Photometric, PlanarConfig und ExtraSamples; dazu aus dem ersten IFD
  ModelPixelScale, ModelTiepoint, GeoKeyDirectory und GDAL_NODATA. Masken-IFDs
  (NewSubfileType mit Bit 4) werden übersprungen.
- Liegen Offset-Arrays hinter dem gelesenen Kopfbereich, lädt der Leser sie nach, innerhalb der
  1-MiB-Grenze. Der Ablauf ist „lesen, fehlende Bereiche melden, nachladen, erneut lesen“; so
  bleibt `parse_kopf` rein.
- **Darstellbar** ist ein Bild nur mit: ProjectedCSType 3857 (oder GeographicType + ProjCS, die
  auf 3857 führen; der Builder nimmt nur 3857 an, wenn der Kopf nichts anderes eindeutig nennt),
  ohne ModelTransformation mit Rotation, gekachelt, 8 Bit, PlanarConfig 1, 1 Kanal (Grau),
  3 Kanäle (RGB) oder 4 Kanäle (RGBA), Compression 1 (keine), 5 (LZW), 8 oder 32946 (Deflate)
  oder 7 (JPEG), Predictor 1 oder 2. Alles andere: `darstellbar: false`, die Ebenenzeile sagt
  „nicht darstellbar“, und es gibt keine Kachelroute.
- Entpacken: Deflate über `flate2`, LZW über `weezl` (liegt über `image`/`tiff` schon im Baum,
  als direkte Abhängigkeit aufnehmen) und JPEG über `image`
  (vorhanden, mit Feature `jpeg`; JPEGTables, Tag 347, voranstellen). Danach Prädiktor 2
  rückrechnen.
- Durchsichtig wird ein Pixel, wenn alle Kanäle dem Nodata-Wert gleichen. Bei RGBA zählt der
  Alphakanal. Ohne Nodata gilt 0 bei RGB (so liefert es die Quelle).
- PNG über `image` (Feature `png`, vorhanden).

**5. Kachel-Cache** (`tile_cache.rs`)

Gerenderte Kacheln brauchen keinen HTTP-Upstream. `TileCache` bekommt zwei schmale Funktionen,
`lies_eintrag(schluessel)` und `schreibe_eintrag(schluessel, bytes, content_type)`. Sie gehen über
dieselbe Tabelle, denselben LRU und denselben Größendeckel von 256 MiB. Cache-Fehler sind wie
heute nie fatal.

### Frontend

- `api/fachebenen.ts`: Abruf `copernicus_bilder` mit `bbox` und `archiv`. Er nutzt denselben
  Weg wie `copernicus`; der Query-Key enthält den Archiv-Schalter.
- `fachebenen.ts`: Eintrag `copernicus_bilder` mit `bboxAbhaengig: true`, `minZoom:
  BBOX_MIN_ZOOM`, `pollMs` und `veraltetNachMin` wie `copernicus`. `geltung`: „Nur optische
  Aufnahmen, nur wo Copernicus aktiviert wurde“. Neu: `darstellung: 'raster'`. Die Ebene zeichnet
  keine Features, sondern je darstellbarem Bild eine Rasterquelle.
- `leistenDaten.ts`: Gruppe `satellit` nennt `['copernicus', 'copernicus_bilder']`.
  `fachebenenAuswahl.ts` und `useKartenAnsicht.ts`: voreingestellt aus; gespeichert wie
  `copernicus`.
- **Archiv-Schalter:** Es gibt einen Schalter für beide Ebenen. Er steht weiter an der Zeile
  `copernicus` und wirkt auf beide. Ist nur `copernicus_bilder` an, steht er an dessen Zeile.
  Wie bisher wird er nicht gespeichert.
- **Rasterlayer** (neu `copernicusBildLayer.ts`, Muster `bildLayer.ts`):
  - je Bild eine Quelle `copernicus-bild-<kennung>` mit `type: 'raster'`, `tiles:
    ['/api/map/overlays/copernicus/images/<kennung>/{z}/{x}/{y}']`, `tileSize: 256`, `bounds`,
    `minzoom` und `maxzoom` aus dem Feature;
  - je Bild ein Layer `…-raster` mit `raster-opacity` aus der Deckkraft und
    `raster-fade-duration: 0`;
  - Soll-Abgleich wie `synchronisiereBildLayer`: anlegen, nachführen, entfernen;
  - Reihenfolge: jüngste Aufnahme oben.
- **Ebenenfolge:** Die Rasterlayer liegen unter allen Fachebenen-Layern und unter den eigenen
  Kartenbildern (`bild-*`). `beforeId` ist der unterste vorhandene dieser Layer, sonst
  `abschnitte-fill`. Nach jedem Stilwechsel wird der Abgleich neu angestoßen, wie bei den
  Kartenbildern.
- **Deckkraft:** ein Regler in der Ebenenzeile (`CopernicusBilderZusatz.tsx`), 0 bis 100 %,
  Vorgabe 80 %. Gespeichert pro Gerät wie andere Ansichtswahl, ohne Einsatzbezug, in der
  Kartenansicht.
- **Ebenenzeile:** Bei `leer` steht „Keine Satellitenbilder im Ausschnitt“, bei `ok` je Bild eine
  Zeile: `EMSR728 · Stuttgart · GeoEye-1 · 081053Bjun24`. Dazu kommen die Altersmarke wie in
  `isCopernicusAufnahmeAlt` und „nicht darstellbar“, wo zutreffend, sowie „weiter hineinzoomen“
  bei `gekuerzt` oder unter `min_zoom`.
- Attribution über den vorhandenen Weg, mit derselben Zeile wie die Vektorebene.
- Keine neuen Farbtöne; die Altersmarke nutzt `rollen.achtungText`.

Der Eintrag `cog-kopf:` unterliegt demselben LRU wie die Kacheln. Wird er verdrängt, baut der
nächste Abruf der Liste ihn neu; bis dahin antwortet eine Kachel ohne Cache-Treffer mit 404.

### Doku

- `docs/fachebenen-quellen.md`: Zeile für `copernicus_bilder` in den Tabellen, ein Abschnitt zu
  COG, Übersichtswahl, Grenzen und „nur EPSG:3857“.
- `docs/anwender/kapitel/lagekarte.md`: die zweite Ebene, Deckkraft, Alter der Aufnahme, „nicht
  darstellbar“. Bilder nach `docs/anwender/AGENTS.md`.
- Architektur: neue ADR „Copernicus-Rasterbilder werden serverseitig gekachelt“ (Ansätze 1–3 als
  Begründung), Nummer und Verweise nach `docs/architektur/AGENTS.md`; Bezug auf ADR-0079.
  Kapitel 3 (Kontext) und das Kapitel zur Lagekarte nach `scripts/adr-fuer.sh` mitziehen.

## Tests

- **Rust, ohne Netz:**
  - Testdatei `src/karte/testdaten/copernicus-cog-kopf.bin`: die ersten 16 KiB des echten
    GeoEye-Kopfes (aus der öffentlichen Quelle). Daran prüfen: Kopf lesen, Georeferenz, Stufen,
    darstellbar.
  - Ein kleines synthetisches COG (z. B. 2 × 2 Kacheln mit 16 px, eine Übersicht, Deflate mit
    Prädiktor 2, Nodata 0), im Test erzeugt oder als winzige Datei abgelegt. Daran prüfen:
    Entpacken, Prädiktor, Abtastung, Durchsicht an Nodata und außerhalb, PNG-Größe.
  - Nicht darstellbar: anderer EPSG, Streifen statt Kacheln, 16 Bit, Rotation.
  - Grenzen: Kopf über 1 MiB, Kachel über 2 MiB, kaputte Offsets ergeben einen Fehler, keine
    Panik.
  - Kachelmathematik: Übersichtswahl je Zoom, `min_zoom`/`max_zoom`, `bounds`.
    **Lagerichtig (Abnahme):** Die Kachel, die den Bildursprung (Tiepoint 1019796, 6271424)
    enthält, berechnet für z = 14 dasselbe x/y wie der Umrechner der Karte.
  - Details: Bilder werden über `fileName` mit Sensor und Aufnahme verbunden (EMSR728 MONIT04:
    zwei Bilder); Pfadprüfung lehnt `..`, absolute URLs und Nicht-`.tif` ab; nur Bilder
    gewählter Produkte.
  - Route: 404 bei unbekannter oder falsch geformter Kennung, 400 bei falscher Kachel, 204
    außerhalb von `bounds`, 400 ohne bzw. mit zu großer `bbox` an der Liste; der Archiv-Schlüssel
    ist ein eigener.
  - Kachel-Cache: Treffer ohne Abruf; S3 weg, Kachel im Cache → ausgeliefert.
- **Frontend (Vitest):** Gruppen-Wächter, TTL gegen Takt, Soll-Abgleich der Rasterquellen,
  `beforeId` unter Fachebenen und Kartenbildern, Deckkraft, Archiv-Schalter wirkt auf beide und im
  Query-Key, Ebenenzeile (leer, ok, alt, nicht darstellbar, gekürzt).
- **Bild der Änderung:** Lagekarte über Stuttgart, Archiv an, Live-Daten EMSR728, Bild unter den
  Überflutungsflächen bei 80 %, Ebenenzeile offen.

## Risiken

- **Format der Quelle:** Andere Aktivierungen könnten anders projizierte oder kodierte COGs
  liefern. Dafür gibt es „nicht darstellbar“ statt einer falschen Lage; die Vektorebene bleibt
  davon unberührt.
- **Last:** Ein Hineinzoomen über einem großen Gebiet erzeugt viele Kacheln. Dagegen stehen
  `min_zoom`, die Proxy-Grenze, `MAX_BILDER` und der Cache. S3-Abrufe sind Range-Abrufe von je
  höchstens 2 MiB.
- **Speicher:** Höchstens 4 entpackte 512er-Kacheln (je 1 MiB bei RGBA) je laufender Zielkachel,
  begrenzt durch die Proxy-Grenze.
- **Detail-Schnittstelle ohne Zusage:** wie LLH-1200. Bricht sie, sind beide Ebenen `offline`.

## Dem Builder überlassen

- Schnitt zwischen `copernicus.rs` und einem Untermodul; Name der gemeinsamen Auswahlkette.
- Nächster Nachbar oder bilinear (s. o.).
- Genaue Form des Deckkraftreglers (antd `Slider` im Stil der übrigen Ebenenzusätze).
