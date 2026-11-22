# Fachebene Copernicus EMS Rapid Mapping (LLH-1200)

Stand: 21.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/wqafyn8uobx1zzsuz1ps572q ·
Abgestimmt: Ruben im Chat, 21.11.2026 (Phase-1-Checkpoint, alle vier Empfehlungen gewählt) ·
Freigabe des Entwurfs: Ruben im Chat, 21.11.2026 („Entwurf passt, go“)

## Absicht

Bei Großschadenslagen wertet der Copernicus Emergency Management Service (CEMS) auf Anforderung
Satellitenbilder aus: Überflutungsflächen, Brandflächen, Wassertiefe, beschädigte Gebäude und
Straßen. Die Lagekarte soll diese Auswertungen als Fachebene zeigen, sobald eine Aktivierung im
Kartenausschnitt liegt, mit Aufnahmezeit, Produkt und Version. Ein Satellitenbild ist Stunden
bis Tage alt; wer die Fläche sieht, muss das Alter mitlesen.

## Ziele

- Neue Fachebene `copernicus` über `GET /api/karte/fachebenen/copernicus?bbox=…[&archiv=1]`,
  im selben Umschlag, mit Cache und Offline-Verhalten wie die übrigen Quellen.
- Gezeigt wird je Auswertungsgebiet (AOI) der jüngste Stand jeder Produktart, dazu der Umriss
  des Gebiets. Was außerhalb des Umrisses liegt, hat Copernicus nicht ausgewertet. Eine leere
  Fläche dort heißt deshalb nicht „trocken“.
- Der Inspector nennt EMSR-Nummer, Aktivierung, Gebiet, Produkt, Version, Aufnahmezeit und
  Sensor, Lieferzeit und Klasse.
- Ohne Aktivierung im Ausschnitt: Status `leer` und der Hinweis „Keine Copernicus-Auswertung im
  Ausschnitt“, kein Fehler.
- Abnahme an **EMSR728** (Hochwasser Süddeutschland, Juni 2024): Die Überflutungsflächen liegen
  lagerichtig, belegt durch Testdaten aus dem echten Abruf und ein Bild mit Live-Daten.

## Nicht-Ziele

- **Kein Adapter-Rahmen (LLH-1632).** Copernicus braucht weder Schlüssel noch Geheimnisse und
  keinen Hintergrundabruf. Der Zustand des Adapters ist der Status der Fachebene mit
  `abgerufen`. Zieht LLH-1632 später ein, kann Copernicus umziehen; nötig ist es nicht.
- **Keine Aktivierungen vor März 2023.** Öffentliche Details mit GeoJSON gibt es erst ab
  EMSR656. EMSR517 (Ahrtal 2021) antwortet mit 403. Ältere Aktivierungen bräuchten einen ZIP-
  und Shapefile-Import; das wird eine Folgeaufgabe.
- **Keine Rasterbilder (COG).** Folgeaufgabe, wie in der Aufgabe als „optional“ vorgesehen.
- **Kein Einsatzbezug.** Die Ebene fragt nach dem Kartenausschnitt wie KRITIS und Energie. Einen
  Einsatzort kennt keine Fachebene, und dafür bräuchte es eine Rechteprüfung.
- Kein Schalter je Org oder Admin. Es gibt ihn für keine Fachebene.

## Ansätze

1. **Fachebenen-Weg mit Abruf bei Bedarf (gewählt).** Liste, Details und Ebenen-GeoJSON laufen
   über den vorhandenen Fachebenen-Cache (`fachebenen_cache`, `liefere_mit_swr`,
   `http_begrenzt`). Kann sofort starten und nutzt die bekannten Wächter (TTL gegen Takt,
   ETag/304).
2. Adapter-Rahmen LLH-1632 zuerst, Copernicus als Hintergrundadapter. Verworfen: Der Rahmen löst
   Geheimnisse und Freigaben, die Copernicus nicht braucht, und LLH-1200 würde Wochen warten.
3. Produkt-ZIPs mit Shapefiles laden. Verworfen für diesen Schritt: Das GeoJSON je Ebene liegt
   fertig in WGS84 vor. Ein Shapefile-Parser käme nur für den Altbestand in Frage (Folgeaufgabe).

**Raumbezug:** Kartenausschnitt (gewählt) statt Einsatzort, Begründung siehe Nicht-Ziele.
**Zeitfilter:** laufend und in den letzten 30 Tagen aktualisiert, ältere nur auf Wahl
(„Archiv“) (gewählt). Verworfen: alle mit Altersmarke, denn das mischt die Flut von 2024 in eine
neue Lage; und nur laufende, denn dann ginge keine Abnahme an einer historischen Aktivierung.

## Die Quelle

Geprüft am 21.11.2026 gegen die echten Endpunkte:

| Zweck | Endpunkt | Inhalt |
| --- | --- | --- |
| Liste | `https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=500` | 270 Aktivierungen ab EMSR656: `code`, `name`, `centroid` (WKT), `activationTime`, `lastUpdate`, `closed`, `n_products`, `category` |
| Details | `…/dashboard-api/public-activations/?code=EMSRnnn` | `sensitive`, `aois[]` mit `extent` (WKT), `products[]` mit `type` (DEL, GRA, FEP), `monitoringNumber`, `version{number, deliveryTime, statusCode}`, `images[]{sensorName, acquisitionTime}`, `layers[]{format, json}` |
| Ebene | `https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com/EMSR…/…_<ebene>_v<n>.json` | GeoJSON, CRS84 (= WGS84, lon/lat), 0,5 bis 1 MB je Datei |

Die Detail-Schnittstelle ist ein Pfad des Dashboard-Backends und hat keine Stabilitätszusage.
Bricht sie, meldet die Ebene `offline`, wie jede andere Quelle. Lizenz: frei mit Quellenangabe
„© European Union, Copernicus Emergency Management Service“.

## Entwurf

### Backend: `src/karte/copernicus.rs`

Ein eigenes Modul neben `quellen.rs`, weil die Quelle drei Stufen hat. `quellen.rs` hat schon
2 900 Zeilen. `routes/karte.rs` bekommt den Arm `"copernicus"`. Wie bei Energie ist `bbox`
Pflicht (400 `Validation` ohne), die Spanne ist auf 3° je Achse begrenzt (eigene Konstante,
Wert wie Energie).

1. **Liste** (Schlüssel `copernicus:liste`, `COPERNICUS_TTL` = 1 800 s, SWR). Bleibt die Liste
   aus, ist die Antwort `offline`.
2. **Auswahl** der Aktivierungen, ohne Netz prüfbar:
   - `n_products > 0`;
   - Zeitfilter: `closed == false` oder `lastUpdate` höchstens 30 Tage alt; mit `archiv=1`
     entfällt er;
   - Mittelpunkt höchstens 500 km vom Ausschnitt entfernt. Grobe Vorauswahl, denn der
     Mittelpunkt liegt fern der Gebiete: Bei EMSR728 liegt Stuttgart 140 km davon entfernt.
3. **Details** je Kandidat (Schlüssel `copernicus:akt:<code>`). Laufende Aktivierungen bekommen
   `COPERNICUS_TTL`, abgeschlossene 24 h, unter dem Cache-Deckel von 48 h. `sensitive: true`
   fällt heraus. Ein Gebiet zählt, wenn das Rechteck um sein `extent` den Ausschnitt schneidet.
   Für einen Kartenausschnitt genügt das Rechteck; ein Geometrie-Crate kommt nicht dazu.
4. **Produktwahl** je Gebiet und Art: nur fertige Versionen (`statusCode == "F"`), davon die
   mit der höchsten `monitoringNumber`, bei Gleichstand die höchste Versionsnummer. FEP (erste
   Abschätzung) nur, solange es für das Gebiet kein DEL gibt.
5. **Ebenen** des gewählten Produkts mit `format == "vt"` und bekannter Art (Liste unten); je
   Datei ein Cache-Eintrag `copernicus:ebene:<pfad>` mit 24 h TTL. Die Version steht im
   Dateinamen, der Inhalt ändert sich also nicht. Jede Datei wird mit `DECKEL_FACHEBENE`
   gelesen. Fehlt eine Ebene, fehlt nur sie; ihr Gebiet trägt dann `unvollstaendig: true`. Die
   Antwort ist begrenzt, über die Spanne und eine Obergrenze von 40 Ebenen-Dateien je Antwort. Wo
   die Obergrenze greift, steht im Gebiet `gekuerzt: true`, und der Inspector sagt „weiter
   hineinzoomen“.
6. **Normalisierung** in eine FeatureCollection. Jedes Feature trägt einheitliche Felder:

   | Feld | Inhalt |
   | --- | --- |
   | `art` | `gebiet` (Umriss der AOI), `beobachtet` (observedEvent A/L/P), `max_ausdehnung` (maximumFloodExtentA), `wassertiefe` (floodDepthA), `nicht_ausgewertet` (notAnalysedA), `schaden_gebaeude` (builtUp P/A), `schaden_verkehr` (transportationL) |
   | `klasse` | Wassertiefe (`value`, z. B. „0.50 - 1.00“) bzw. Schadensgrad (`damage_gra`: Destroyed, Damaged, Possibly damaged, No visible damage) |
   | `emsr`, `aktivierung`, `kategorie` | EMSR-Nummer, Name, Ereignisart |
   | `gebiet` | Name der AOI |
   | `produkt`, `monitoring`, `version` | DEL/GRA/FEP, Monitoring-Nummer, Versionsnummer |
   | `aufnahme`, `sensor` | jüngste `acquisitionTime` der Bilder des Produkts, deren Sensor |
   | `geliefert` | `version.deliveryTime` |
   | `beschreibung` | `obj_desc` bzw. `notation` bzw. `info` der Quelle, unverändert englisch |

   Andere Ebenenarten (`naturalLandUseA`, `modelledEventA`, Referenzdaten) bleiben draußen.
   `modelledEventA` ist ein Modell, keine Beobachtung, und würde neben `beobachtet` verwechselt.
   `stand` des Umschlags ist die jüngste `aufnahme` aller gezeigten Produkte.

Cache-Schlüssel der Antwort: `bbox.cache_key_mit("copernicus")` bzw. `copernicus-archiv`. Die
drei Stufen haben eigene Schlüssel, eine Antwort für einen neuen Ausschnitt lädt also nichts
doppelt. Clients nur über `ausgehend::client_builder(Zweck::Lagekarte)` (vorhanden).

Der Umschlag `FachebeneAntwort` und der Status bleiben unverändert; ein Typ-Codegen ist nicht
nötig (`quelle` ist ein String).

### Frontend

- `api/fachebenen.ts`: `copernicus` in die Union; `archiv` als Parameter beim Laden.
- `fachebenen.ts`, Eintrag `copernicus`:
  - `geometrieTyp: 'polygon'`, `bboxAbhaengig: true`, `minZoom: BBOX_MIN_ZOOM`;
  - `pollMs` 10 min, unter der TTL von 30 min, damit eine laufende Aktivierung neue Produkte
    zeigt. Trägt der bbox-Weg in `useFachebenen.ts` heute keinen Takt, bekommt er einen; der
    Wächter in `fachebenen.test.ts` liest `COPERNICUS_TTL`;
  - `veraltetNachMin` 120: vier verpasste Erneuerungen. Das ist das Alter des Abrufs; das Alter
    des Bildes zeigt die Aufnahmezeit;
  - `geltung`: „Nur wo Copernicus aktiviert wurde; ab 2023“;
  - `klassenfarben` nach `art` und `klasse`.
- **Linien und Punkte in einer Flächenebene:** `fachebenenLayer.ts` zeichnet bei
  `geometrieTyp: 'polygon'` bisher nur Flächen. Für Straßen (Linien) und Gebäudepunkte kommen ein
  Linien- und ein Kreis-Layer mit Filter auf den Geometrietyp dazu, nur für Ebenen, die das
  angeben (neues Feld `gemischteGeometrie: true`). Die übrigen Ebenen bleiben byte-gleich. Treffer
  wie gehabt, Punkte mit Trefferzone (LFH-600).
- **Darstellung:**
  - `gebiet`: nur Umriss, gestrichelt;
  - `nicht_ausgewertet`: grau schraffiert bzw. blass grau;
  - `beobachtet` und `max_ausdehnung`: Wasser-Ton (bei Brand ein Brand-Ton nach `kategorie`);
  - `wassertiefe`: drei Stufen desselben Tons;
  - Schadensgrade: Zerstört, Beschädigt, Möglicherweise beschädigt in einer Warnskala.

  Alle Töne in `theme/tokens.ts` (hell und dunkel) und `statusFarben.ts`, keine Literale in
  `fachebenen.ts`.
- **Gruppe** im Ebenenbaum: neue Gruppe „Satellitenauswertung“ (`satellit`) in
  `FACHEBENEN_GRUPPEN`, später auch für die Rasterbilder.
- **Archiv:** In der Zeile der Ebene steht ein Schalter „Ältere Aktivierungen“, voreingestellt
  aus. Er wird nicht gespeichert: Wer die Seite neu lädt, sieht wieder nur Aktuelles. Ein
  vergessener Archivschalter mischte sonst Altes in eine neue Lage.
- **Panel:** Bei `leer` steht der Hinweis „Keine Copernicus-Auswertung im Ausschnitt“. Bei `ok`
  stehen unter dem Stand die EMSR-Nummern im Ausschnitt mit Aufnahmezeit als DTG.
- **Inspector:** eigener Zweig `CopernicusInhalt` mit allen Feldern der Tabelle, die Klasse auf
  Deutsch, die Beschreibung der Quelle darunter. Dazu ein Link zur Aktivierung bei Copernicus
  (`https://rapidmapping.emergency.copernicus.eu/EMSRnnn`) und die Marke „Satellitenaufnahme vom
  <DTG>“ in der Achtung-Textfarbe, wenn die Aufnahme älter als 24 h ist.
- Attribution über den vorhandenen Weg in die Attributionszeile der Karte.

### Doku

- `docs/fachebenen-quellen.md`: Zeile in der TTL-, Takt- und Veraltet-Tabelle und in der
  Quellen- und Lizenztabelle, ein Abschnitt zu Auswahl, Produktwahl und Grenze ab 2023.
- `docs/anwender/kapitel/lagekarte.md`: die neue Gruppe und wie man die Ebene liest (Umriss,
  Aufnahmezeit, Archiv). Bilder nach den Regeln in `docs/anwender/AGENTS.md`.
- Architektur: Kapitel und ADRs prüfe ich mit `scripts/adr-fuer.sh`. Eine neue externe Quelle
  steht vermutlich in der Kontextabgrenzung (Kapitel 3).

## Tests

- Rust, ohne Netz, mit Testdaten in `src/karte/testdaten/copernicus/`: ein gekürzter Auszug der
  echten Liste, die Details von EMSR728 (Gebiete 1 und 9), je eine Ebene DEL floodDepthA und GRA
  transportationL, gekürzt auf wenige Features.
  - Auswahl: Zeitfilter mit und ohne Archiv, 500-km-Vorauswahl, `sensitive`, `n_products = 0`.
  - Gebiet schneidet den Ausschnitt bzw. nicht.
  - Produktwahl: Monitoring vor Erstprodukt, höhere Version, FEP nur ohne DEL, nur `statusCode
    F`.
  - Normalisierung: Felder, Klassen, unbekannte Ebenenart bleibt draußen.
  - **Lagerichtig (Abnahme):** Für einen Ausschnitt um Stuttgart liegen alle Koordinaten der
    Überflutungsflächen von EMSR728 im Umriss von Gebiet 1 und in lon/lat-Reihenfolge.
  - Ein Ausschnitt ohne Aktivierung ergibt `leer`; ausbleibende Details ergeben `offline`; fehlt
    eine Ebene, ist das Gebiet `unvollstaendig`; die Dateigrenze setzt `gekuerzt`.
  - Route: 400 ohne bzw. mit zu großer bbox; `archiv=1` hat einen eigenen Cache-Schlüssel.
- Frontend (Vitest): Wächter TTL gegen Takt, Gruppen-Wächter, Farbvertrag, `fachebenenLayer` für
  gemischte Geometrie (übrige Ebenen unverändert), Inspector-Zweig, Archiv-Schalter landet im
  Query-Key und wird nicht gespeichert, Hinweis bei `leer`.
- Bild der Änderung: Lagekarte über Stuttgart mit Archiv an, Live-Daten EMSR728, Inspector
  geöffnet.

## Risiken

- **Detail-Schnittstelle ohne Zusage:** Bricht sie, ist die Ebene `offline` und das Panel sagt
  es. Der Normalisierer prüft die Felder und überspringt, was nicht passt, statt abzubrechen.
- **Größe:** Ein Hochwasser mit vielen Gebieten erreicht schnell 10 bis 20 MB. Dagegen helfen
  die Spanne von 3°, `minZoom` und die Obergrenze von 40 Dateien. Ist die Antwort einmal im
  Cache, kostet ein Poll nur ein 304.
- **Missverständnis „keine Fläche = kein Wasser“:** Dagegen stehen der Umriss des Gebiets,
  „nicht ausgewertet“ und die Aufnahmezeit im Inspector.

## Folgeaufgaben (werden angelegt)

- Rasterbilder (COG) der Aktivierungen als Kachelebene.
- Altbestand vor 2023 (EMSR517 u. a.) über Produkt-ZIPs mit Shapefiles, falls Bedarf besteht.
