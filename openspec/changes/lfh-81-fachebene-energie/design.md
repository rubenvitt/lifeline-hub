# Design

## Context

Warum die Ebene hybrid ist und warum sie `energie` heißt: siehe proposal.md. Diese Datei
hält die Entscheidungen fest, die aus dem Bestand folgen.

**Bestand, auf dem aufgebaut wird** (gelesen am 21.09.2026):

- Eine einzige dynamische Route `GET /api/karte/fachebenen/{quelle}` (`src/app.rs`). Der
  Handler `routes::karte::fachebenen` verteilt per `match` auf `quellen::fetch_*`. KRITIS
  ist der einzige Zweig mit Pflicht-bbox.
- `liefere_mit_swr` (`src/karte/quellen.rs`) ist der gemeinsame SWR-Kern: frischer Stand
  sofort, veralteter Stand sofort plus Refresh im Hintergrund, kalter Cache blockierend.
  Er arbeitet mit **einem** Schlüssel und **einer** TTL.
- `Bbox::parse` lehnt Ausschnitte über 1° ab. `Bbox::cache_key()` hat das Präfix `kritis:`
  **fest eingebaut**.
- Das Frontend reicht die bbox **nur an KRITIS**: `LagekartePage.tsx` setzt
  `onBboxAenderung` nur bei `fachebenenSichtbar.kritis`, `Kartenflaeche.tsx` meldet ab
  `KRITIS_MIN_ZOOM` (10), und `useFachebenen` hält `kritisBbox`, `kritisAkku` und
  `kritisZoomZuKlein`.
- `FachebenenInspector.tsx` fällt bei jeder unbekannten Quelle still in `KritisInhalt`.
- `useKartenAnsicht.ts`: `FACHEBENE_KEYS` fehlt schon heute `hochwasser` (eine Lücke im
  Bestand, siehe Entscheidung 8).

**Gemessen** (21.09.2026, Live-Endpunkte):

- Der MaStR-Abruf mit Filter `Nettonennleistung > 10000 kW`, Koordinate vorhanden und
  Status 35/37 liefert 1.267 Einheiten in **einem** Abruf (`pageSize=2000`), rund
  **6,8 s**, 5,2 MB. Aufteilung: Solar 752, Speicher 204, Wind 167, Wasser 98,
  Biomasse 46. Ohne Statusfilter wären es 1.755 Einheiten, 8,7 s und 7,1 MB.
- Overpass `power=plant` im Ruhrgebiet (0,3° × 0,6°) liefert 30 Objekte. Davon tragen
  Scholven, GuD Herne und HKW Herne `plant:output:electricity` als Text, etwa `690 MW`.
  Die Angabe kommt auch als `yes` vor.

## Goals / Non-Goals

**Goals:**

- Eine bbox-getriebene Ebene, die ohne neuen Mechanismus auskommt: kein Scheduler, keine
  Migration, keine neue Abhängigkeit.
- Der bbox-Pfad im Frontend hängt künftig an `bboxAbhaengig` statt an KRITIS.

**Non-Goals:**

- Der **MaStR-Gesamtexport** (3 GB XML) und der **SOAP-Webdienst** (Registrierung
  nötig). Sie bleiben Ausweichwege, falls der JSON-Endpunkt wegfällt.
- Gas-Infrastruktur und Netzanschlusspunkte aus MaStR (dort ohne Koordinaten).
- Eine Einfärbung je Anlagenart auf der Karte. Die Ebene hat **eine** Farbe, die
  Anlagenart steht im Inspector. Das deckt sich mit der KRITIS-Ebene, deren Kategorien
  ebenfalls einfarbig sind.
- Eine Störungs- oder Ausfalllage (siehe LFH-69, dafür gibt es keine offene Quelle).

## Decisions

### 1. Eine Kennung, zwei Cache-Einträge, zusammengeführt bei der Anfrage

`fetch_energie` fragt zwei Teile unabhängig voneinander ab und führt sie erst bei der
Anfrage zusammen:

| Teil | Schlüssel | TTL | kalter Pfad |
|---|---|---|---|
| OSM `power=plant` | `energie:osm:<bbox gerundet>` | 24 h | blockierend (wie KRITIS), 30-s-Timeout, zwei Overpass-Endpunkte |
| MaStR-Abzug | `energie:mastr` (bundesweit) | 24 h | blockierend mit eigenem 30-s-Timeout, 5-min-Sperre nach Fehlschlag |

Beide kalten Pfade laufen **nebenläufig** (`tokio::join!`). Die Wartezeit ist also die
längere der beiden, nicht ihre Summe. Beide Teile gehen durch `liefere_mit_swr`: die
Staffelung frisch/veraltet/kalt ist das etablierte Verhalten.

`Bbox::cache_key()` bekommt das Präfix als Parameter, oder es kommt eine zweite Methode
hinzu. Das feste `kritis:` bleibt für KRITIS **byte-gleich**, sonst verlöre der Bestand
seinen Cache.

*Verworfen:* **zwei getrennte Ebenen** (OSM-Kraftwerke und MaStR). Die Bedienperson sähe
dasselbe Wasserkraftwerk doppelt, und die Zusammenführung aus Entscheidung 4 ginge nicht.
*Verworfen:* ein **nächtlicher Batch-Job**. Das wäre ein neuer Mechanismus, den keine
andere Fachebene hat. Eine TTL von 24 h im SWR-Kern leistet dasselbe: veraltet wird im
Hintergrund erneuert, ohne dass jemand wartet.
*Verworfen:* der **Autobahn-Weg**, also ein kalter Pfad ohne Warten mit
`aufwaermPollMs`. Den braucht Autobahn, weil sein Fächer rund 25 s dauert. Der
MaStR-Abruf ist ein einzelner Request von ~7 s und fällt nur einmal am Tag an. Dazu
kommt: eine bbox-Ebene hat im Frontend keinen `refetchInterval`, ein „wärmt noch
auf“-Zustand würde also erst beim nächsten Verschieben der Karte aufgelöst.

### 2. Der MaStR-Abruf filtert beim Upstream, nicht bei uns

Filter im Abruf:
`Nettonennleistung der Einheit~gt~10000 ~and~ Koordinate: Breitengrad (WGS84)~gt~-90 ~and~ Betriebs-Status~eq~'35,37'`,
`pageSize=2000`. Dabei gilt:

- **`gt` ist nicht dokumentiert**, funktioniert aber live, und zwar numerisch (gegengeprüft:
  die Zahlen über 10 MW, über 50 MW und im Band 10–50 MW gehen auf).
- Das `gt~-90` auf den Breitengrad sortiert Einheiten ohne Koordinate aus: `NULL` erfüllt
  keinen Bereichsvergleich.
- Liefert der Upstream `Total > pageSize`, holt der Adapter die weiteren Seiten
  **nacheinander**. Mit dem heutigen Bestand kommt das nicht vor. Die Grenze hängt aber
  an Zubau, den wir nicht steuern, und ein stilles Abschneiden bei 2000 würde niemand
  bemerken.
- Der User-Agent ist der bestehende Client-UA (`LifelineHub-Lagekarte/1.0`).

Die Filterfeldnamen sind die Anzeigenamen des Portals, sie können sich deshalb ändern.
Sieht eine Antwort anders aus als erwartet (etwa kein `Data`-Array), ist das ein
**Fehlschlag** und kein leerer Stand. Ein Leerstand sähe aus wie „keine Großanlagen in
Deutschland“, und niemand würde misstrauisch.

*Verworfen:* ungefiltert holen und lokal filtern. Das wären 9 Mio. Einträge.

### 3. Klassifikation der Anlagenart: ein Schlüssel für beide Quellen

Eine feste Menge `kohle | gas | oel | kern | abfall | wasser | wind | solar | biomasse |
speicher | sonstige` mit zwei Zuordnungen:

- MaStR `EnergietraegerName`: Braunkohle/Steinkohle → `kohle`, Erdgas/andere Gase/
  Grubengas → `gas`, Mineralölprodukte → `oel`, Kernenergie → `kern`, nicht biogener
  Abfall → `abfall`, Wasser → `wasser`, Wind → `wind`, Solare Strahlungsenergie → `solar`,
  Biomasse → `biomasse`, Speicher → `speicher`, alles andere (Wärme, Geothermie, …) →
  `sonstige`.
- OSM `plant:source` (Mehrfachwerte mit `;`, der **erste** Wert zählt): coal/lignite →
  `kohle`, gas/biogas → `gas` bzw. `biomasse` für biogas, oil → `oel`, nuclear → `kern`,
  waste → `abfall`, hydro → `wasser`, wind → `wind`, solar → `solar`, biomass → `biomasse`,
  battery → `speicher`.

**Nachtrag aus der Umsetzung:** OSM `hydro` mit `plant:method=water-pumped-storage` wird
`speicher`, weil MaStR Pumpspeicherwerke als Speicher führt. Ohne diese Regel standen am
PSW Happurg live fünf Punkte statt einem.

„Konventionell“ im Sinne des Rauschfilters sind `kohle | gas | oel | kern | abfall`. Aus
`plant:source=biogas` wird bewusst `biomasse` und nicht `gas`: Biogasanlagen gibt es zu
Tausenden im Kleinformat, und als „konventionell“ gezählt kämen sie ohne Leistungsschwelle
durch.

Die Leistung aus OSM wird tolerant gelesen: `690 MW`, `690MW`, `1.2 GW`, `12000 kW`,
`12.1 MW`. Alles, was sich nicht eindeutig lesen lässt (`yes`, leer, `~50`), gilt als
**unbekannt**. Eine geschätzte Zahl erscheint nie als Messwert.

### 4. Zusammenführung per Nähe und Anlagenart, auf der OSM-Seite

Je Anfrage sind die Mengen klein (OSM im Ausschnitt ≤ ~100, MaStR im Ausschnitt ≤ ~50).
Deshalb ein O(n·m)-Abgleich mit Haversine: Eine MaStR-Einheit wird der **nächsten**
OSM-Anlage gleicher Anlagenart im Umkreis von **2 km** zugeordnet. Mehrere MaStR-Einheiten
an einer OSM-Anlage (etwa die Blöcke eines Speicherparks) summieren ihre Leistung. Die
MaStR-Nummer der größten Einheit wird geführt, dazu die Zahl der Einheiten. Der Punkt
bleibt am **OSM**-Standort, weil die OSM-Mitte die Anlage besser trifft als der
Einheitenpunkt.

2 km und nicht 500 m: Solarparks und Speicheranlagen sind flächig, und ihre OSM-Mitte
kann weit neben der Einheitenkoordinate liegen. Das ist **angenommen, nicht gemessen**.
Aufgabe 2.4 misst den Abstand an einer Stichprobe echter Paare und legt die Zahl fest,
bevor sie in den Code geht. Eine falsche Zuordnung setzt eine gleichartige Nachbaranlage
voraus und kostet eine falsch zugeordnete Leistungsangabe, keinen verschwundenen Punkt.

### 5. Quellennennung aus den tatsächlich beitragenden Teilen

`FachebeneAntwort::ok(quelle, attribution: &str, …)` bleibt unverändert. Die Ebene
übergibt einen zur Laufzeit gebauten `String`: die OSM-Nennung, wenn der OSM-Teil einen
Stand hat, und die MaStR-Nennung, wenn der MaStR-Teil einen hat, getrennt durch „ · “.
Der MaStR-Wortlaut (Lizenztext §2 dl-de/by-2-0, Bereitsteller laut Impressum):
„Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0“. Den **Link** auf
`www.govdata.de/dl-de/by-2-0` und auf den Datensatz tragen `docs/fachebenen-quellen.md`
und der Inspector. Die Attributionszeile der Karte ist Klartext und kann keinen Link
tragen.

`stand` ist der Zeitpunkt des MaStR-Abzugs. Liegt kein MaStR-Stand vor, bleibt das Feld
leer.

### 6. Frontend: der bbox-Pfad wird generisch

- **Ein** Viewport-State `viewportBbox` in `useFachebenen` für alle Ebenen, die
  `istBboxAbhaengig` sind. `LagekartePage` hängt `onBboxAenderung` an, sobald **irgendeine**
  solche Ebene sichtbar ist.
- `KRITIS_MIN_ZOOM` wird zu `BBOX_MIN_ZOOM` (Wert unverändert 10). Das Backend begrenzt
  die bbox ohnehin auf 1°.
- Der Hinweis „zu weit herausgezoomt“ ist ein Record je Quelle (`zoomZuKlein[key]`) statt
  `kritisZoomZuKlein`. `Sidebar` liest ihn für jede bbox-abhängige Ebene.
- Die **Akkumulation** (`mergeFeatures`, Obergrenze) wird je bbox-Ebene geführt, mit
  eigenem Ref und eigener Obergrenze. Energie nimmt 2000 (weit weniger Objekte als
  KRITIS).
- `useQueries` bekommt einen **siebten, literalen** Eintrag. Die Callback-Form bleibt
  gesperrt (siehe den Kommentar in der Datei). `byKey` in `combine` wächst mit, in der
  Reihenfolge von `fachebeneKeys()`.
- Query-Key `globalKeys.fachebeneEnergie(bbox)` nach dem Muster von `fachebeneKritis`, und
  `'energie'` wird aus dem Typ von `globalKeys.fachebene` ausgenommen. Der Byte-Pin in
  `globalKeys.test.ts` bekommt ein handgeschriebenes Literal.
- Ebenenfarbe: ein Ton, den keine der sechs Bestandsebenen belegt (dort Rot, Orange,
  Blau, Türkis, Magenta, Violett). Beim Umsetzen gegen `theme/tokens.ts` prüfen und im
  Test festhalten, dass er nicht mit einer Bestandsebene zusammenfällt.
- `FachebenenInspector`: ein eigener Zweig `EnergieInhalt`, **vor** dem Rückfall auf
  KRITIS.

### 7. Persistenz: Aufzählung statt Spread

`defaultFachebenenSichtbar()` bekommt `energie: false`, `leseFachebenen()` eine Zeile
`energie: o.energie === true`. Auf dieselbe Weise liest ein älterer gespeicherter Stand
den neuen Schlüssel als „aus“. Das Backend speichert `fachebenen_sichtbar` als opakes
JSON, dort ist nichts zu ändern.

### 8. Die Bestandslücke `FACHEBENE_KEYS` wird im selben Zug geschlossen

Die Liste in `useKartenAnsicht.ts` trägt `energie` **und** das fehlende `hochwasser`. Ohne
`hochwasser` sieht die Prüfung auf ungespeicherte Änderungen eine umgeschaltete
Hochwasser-Ebene nicht. Die Zeile wird ohnehin angefasst, und eine halb nachgezogene
Liste wäre der Fehler, den diese Zeile verhindern soll. Die Liste wird dabei aus
`fachebeneKeys()` abgeleitet, damit eine achte Ebene sie nicht wieder vergisst.

## Risks / Trade-offs

- [Der MaStR-JSON-Endpunkt ist nicht offiziell (kein SLA, WAF), Filternamen und `gt`
  können sich still ändern] → Eine unerwartete Antwortform gilt als Fehlschlag, nicht als
  Leerstand. Der letzte gute Stand wird über SWR weiter ausgeliefert (Cache-Aufbewahrung
  2 Tage). Danach degradiert die Ebene auf den OSM-Anteil, und die Quellennennung zeigt
  das an. Als Ausweichweg ist der Gesamtexport in der Doku benannt.
- [Kalter Abruf: Overpass bis 30 s, MaStR ~7 s, der Frontend-Aufruf bricht nach 15 s ab]
  → Das gilt heute schon für KRITIS. Die Anfrage läuft serverseitig zu Ende und schreibt
  den Cache, der nächste Pan trifft ihn. Beide Teile laufen parallel. Gegen einen
  dauerhaft gestörten MaStR hilft die 5-Minuten-Sperre.
- [OSM-Leistungsangaben sind lückenhaft] → Konventionelle Anlagen erscheinen auch ohne
  Leistung (Leistung „unbekannt“). Bei erneuerbaren Anlagen ohne Angabe trägt MaStR die
  Großanlagen. Eine erneuerbare OSM-Anlage ohne Leistung und ohne MaStR-Treffer fällt
  heraus. Das nehmen wir bewusst hin, der Rauschfilter ist die Akzeptanzbedingung.
- [Unscharfe Zuordnung über 2 km] → Sie gilt nur bei gleicher Anlagenart und nur zur
  jeweils nächsten Anlage. Die Herkunft `osm+mastr` steht im Inspector, eine Zuordnung
  lässt sich also nachprüfen.
- [Konventionelle Großkraftwerke haben in MaStR keine Koordinaten, ihre Leistung kommt
  dann nur aus OSM] → Für diese Anlagenklasse ist das der einzige Weg. Die Doku sagt es,
  damit niemand die Leistung für amtlich hält, solange die Herkunft nur `osm` ist.

## Migration Plan

Keine Datenmigration. Die Ebene ist nach dem Deploy in der Auswahl sichtbar und
ausgeschaltet. Rückbau heißt: den Match-Arm und den Frontend-Eintrag entfernen. Die
Cache-Einträge `energie:*` verfallen nach 2 Tagen von selbst.
