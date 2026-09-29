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
| OSM `power=plant` | `energie:osm:<bbox gerundet>` | 24 h | gelöster Abruf, 30-s-Timeout je Endpunkt, zwei Overpass-Endpunkte, Abfrage auf die um 6 km erweiterte bbox (Entscheidung 4) |
| MaStR-Abzug | `energie:mastr` (bundesweit) | 24 h | gelöster Abruf mit eigenem 30-s-Timeout, 5-min-Sperre nach Fehlschlag |

Die Staffelung frisch/veraltet ist die von `liefere_mit_swr`. **Den kalten Pfad löst die
Ebene von der Anfrage** (`liefere_geloest`): der Abruf läuft per `tokio::spawn` als eigene
Task, und die Anfrage wartet auf beide Teile **zusammen höchstens `ENERGIE_WARTE` = 10 s**.
Beide Teile warten nebenläufig auf denselben Zeitpunkt, jeder für sich; danach antwortet
die Anfrage mit dem, was da ist. Ein Teil, der die Frist reißt, trägt zu dieser Antwort
nichts bei und wird nicht genannt, setzt aber **keine** Sperre. Die Task läuft weiter und
schreibt den Cache bzw. — bei einem echten Fehlschlag — die MaStR-Sperre zu Ende.
`status: offline` gilt nur, wenn kein Teil etwas hat. Holt schon eine andere Anfrage
denselben Schlüssel (`inflight`-Marke), startet keine zweite einen Abruf; sie wartet auch
nicht auf den ersten, sondern trägt diesen Teil nicht bei. Die nächste Anfrage trifft den
Cache. Die MaStR-Einzelspur bleibt als Rückfallebene dahinter.

Warum nicht blockierend (Review-Befund, 21.09.2026): der erste Stand wartete per
`tokio::join!` auf beide kalten Teile, MaStR bis 30 s, Overpass bis 2 × 30 s. `apiGet` im
Frontend bricht nach **15 s** ab. Dann wirkte die **ganze** Ebene offline, obwohl ein Teil
längst da war, was dem Spec-Szenario „Nur OSM erreichbar“ widerspricht. Dazu verwirft axum
den Handler-Future, wenn der Client abbricht. Der MaStR-Abruf starb dann mit ihm, erreichte
seinen Fehlerzweig nie, und die 5-Minuten-Sperre wurde nie gesetzt. 10 s liegen unter den
15 s des Frontends und lassen Luft für Zusammenführung und Übertragung. Die übrigen Ebenen
behalten den blockierenden kalten Pfad von `liefere_mit_swr`.

`Bbox::cache_key()` bekommt das Präfix als Parameter, oder es kommt eine zweite Methode
hinzu. Das feste `kritis:` bleibt für KRITIS **byte-gleich**, sonst verlöre der Bestand
seinen Cache.

*Verworfen:* **zwei getrennte Ebenen** (OSM-Kraftwerke und MaStR). Die Bedienperson sähe
dasselbe Wasserkraftwerk doppelt, und die Zusammenführung aus Entscheidung 4 ginge nicht.
*Verworfen:* ein **nächtlicher Batch-Job**. Das wäre ein neuer Mechanismus, den keine
andere Fachebene hat. Eine TTL von 24 h im SWR-Kern leistet dasselbe: veraltet wird im
Hintergrund erneuert, ohne dass jemand wartet.
*Verworfen:* der **Autobahn-Weg**, also ein kalter Pfad ganz ohne Warten mit
`aufwaermPollMs`. Den braucht Autobahn, weil sein Fächer rund 25 s dauert. Der
MaStR-Abruf ist ein einzelner Request von ~7 s und fällt nur einmal am Tag an, er passt
also in der Regel in die Wartefrist. Dazu kommt: eine bbox-Ebene hat im Frontend keinen
`refetchInterval`, ein „wärmt noch auf“-Zustand würde also erst beim nächsten Verschieben
der Karte aufgelöst. Die Wartefrist ist der Mittelweg: im Normalfall kommt der Teil noch
in derselben Antwort, im Störfall hält er sie nicht über den Abbruch des Frontends hinaus
auf.

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

**Der Abgleich läuft über einen erweiterten Rand, nicht über den Ausschnitt**
(Review-Befund, 21.09.2026). Der erste Stand beschnitt beide Seiten vorher auf die bbox.
Lag eine MaStR-Einheit knapp innerhalb und ihre OSM-Anlage (< 2 km) knapp außerhalb,
entstand ein eigener `mastr`-Punkt. Im Nachbarausschnitt kam nach dem Verschieben die
`osm+mastr`-Anlage dazu, und das Frontend sammelte beide auf. Jetzt gilt (Radius `r`):

- Ausgegeben wird eine OSM-Anlage, wenn sie selbst im Ausschnitt liegt **oder** eine ihr
  zugeordnete Einheit. Sie liegt also höchstens `r` vor der Kante, ihr Punkt kann bis `r`
  außerhalb der bbox stehen. Er ist derselbe wie im Nachbarausschnitt.
- Ein reiner `mastr`-Punkt erscheint, wenn die Einheit im Ausschnitt liegt.
- In den Abgleich gehen Einheiten aus der um `2 r` und OSM-Anlagen aus der um `3 r`
  erweiterten bbox ein. Die Einheiten einer ausgegebenen Anlage liegen bis `2 r` vor der
  Kante, und wohin eine solche Einheit gehört, entscheidet die nächste Anlage bis `3 r`.
  Erst damit ist die Antwort für jeden ausgegebenen Punkt in jedem Ausschnitt dieselbe,
  einschließlich Leistungssumme und Einheitenzahl. Ein Rand von nur `r`, wie im Befund
  vorgeschlagen, verschöbe die Abweichung eine Stufe nach außen. Dann zählte dieselbe
  Anlage in zwei Nachbarausschnitten verschieden viele Einheiten (Tests
  `randanlage_*`, per Mutationsprobe belegt).
- Die Overpass-Abfrage geht deshalb auf die um `3 r` = 6 km erweiterte bbox. Umgerechnet
  wird mit dem Erdradius der Haversine-Messung, die Länge mit dem Kosinus der polnäheren
  Kante. Der **Cache-Schlüssel** des OSM-Teils bleibt am Original-Raster.

Jeder Punkt mit MaStR-Anteil (`mastr`, `osm+mastr`) trägt zusätzlich `mastr_nummern`:
alle MaStR-Nummern der zugeordneten Einheiten, lexikographisch sortiert und ohne
Leerzeichen mit Komma verbunden. Sonst ist das Feld `null`. `mastr_nummer`, `mastr_id` und
`mastr_einheiten` bleiben unverändert.

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

**Nachtrag nach dem Merge mit LFH-83 (21.09.2026).** LFH-83 hat KRITIS parallel auf einen
periodisch importierten OSM-Extrakt umgestellt: KRITIS fragt in **jeder** Zoomstufe, ohne
Größengrenze, bündelt auf der Karte, akkumuliert **nicht** mehr und läuft als eigenes
`useQuery` (in `useQueries` griff `keepPreviousData` beim Schlüsselwechsel nicht). Von der
Verallgemeinerung oben bleibt:

- **Ein** Viewport-State `viewportBbox` und `braucheViewportBbox` — unverändert, und beide
  bbox-Ebenen teilen sich denselben, bereits gerasterten Ausschnitt (die Karte rastert EINMAL
  über die Rasterleiter aus LFH-83, `LagekartePage.tsx`); ein zweites, energie-eigenes Gitter
  ist bewusst **nicht** entstanden — zwei getrennte States könnten nur auseinanderlaufen, und
  die Größengrenze (s. u.) fängt den Fall ab, in dem die Leiterstufe für Energie zu grob wäre.
- Der Mindest-Zoom ist ein Registry-Feld `minZoom` und steht **nur an Energie**
  (`BBOX_MIN_ZOOM` = 10, Name beibehalten). Die Karte meldet Zoom und bbox in jeder
  Zoomstufe; das Gate sitzt jetzt in `useFachebenen` — unter `minZoom` (oder ohne gemeldeten
  Zoom) bleibt die Energie-Query über `enabled: false` aus, ohne eigenen Schlüsselzustand.
- `zoomZuKlein` bleibt ein Record je Quelle, wird aber nur für Ebenen mit `minZoom`
  gefüllt. KRITIS bekommt keinen Hinweis mehr (Spec LFH-83: Bündel statt „näher
  heranzoomen").
- Die **Akkumulation** gilt nur noch für Energie (`mergeEnergieFeatures`, 2000);
  `mergeFeatures` (KRITIS, first-wins) ist entfallen. Energie läuft als eigenes `useQuery`
  neben KRITIS statt im `useQueries`-Tupel — dieselbe Begründung wie bei KRITIS oben
  (`keepPreviousData` griffe bei wechselndem Schlüssel nicht).
- Die **Größengrenze** ist aus `Bbox::parse` in `quellen::pruefe_energie_bbox` gewandert und
  gilt nur noch für Energie. Sie ist dabei von 1° auf **3°** gestiegen: bei Zoom 10 ist ein
  Grad rund 1456 px breit, auf einem 1920-px-Schirm stand die Ebene mit 1° leer auf
  „offline“. Das Frontend prüft dieselbe Spanne vorab (`energieAusschnittPasst` in
  `pages/lagekarte/fachebenen.ts`) und zeigt dann den Zoom-Hinweis; `hole_overpass` wird
  weiterhin nur von Energie genutzt, der KRITIS-Cache-Schlüssel `Bbox::cache_key` ist
  entfallen.

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
- [Kalter Abruf: Overpass bis 2 × 30 s, MaStR ~7 s (Timeout 30 s), der Frontend-Aufruf
  bricht nach 15 s ab] → Beide Abrufe sind von der Anfrage gelöst, die Anfrage wartet
  höchstens 10 s und liefert den Teil, der da ist. Der Abruf schreibt den Cache in der
  gelösten Task zu Ende, auch nach einem Abbruch des Clients, und der nächste Pan trifft
  ihn. Gegen einen dauerhaft gestörten MaStR hilft die 5-Minuten-Sperre. KRITIS behält
  den blockierenden Pfad.
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
