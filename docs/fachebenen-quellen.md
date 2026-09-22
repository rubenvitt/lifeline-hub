# Fachebenen — externe Datenquellen (Lizenz, Attribution, Aktualisierung)

Die Lagekarte holt externe Lagedaten über den Backend-Aggregator
`GET /api/karte/fachebenen/{quelle}`. Das Backend ruft die jeweilige Quelle ab,
normalisiert sie zu einer GeoJSON-`FeatureCollection` und liefert einen einheitlichen
Umschlag `{ quelle, status, attribution, stand, features }`.

**Offline-Verhalten (alle Quellen):** Ist eine Quelle nicht erreichbar (Timeout, DNS,
HTTP-Fehler), antwortet der Aggregator mit HTTP **200** und `status: "offline"` plus leerer
Collection — niemals mit einem 5xx-Fehler. Liegt ein noch gültiger Cache-Eintrag vor, wird
dieser als `status: "ok"` weitergereicht (Stale-Serving). Im Frontend wird eine Ebene mit
`status: "offline"` ausgegraut/als „offline" markiert; `status: "leer"` zeigt „keine Daten".

Die Pflicht-Attribution aktiver, nicht-offline Fachebenen wird in der Karten-Attribution
(unten rechts) eingeblendet.

| Quelle (`quelle`) | Endpoint | Format / Geometrie | Lizenz | Pflicht-Attribution | Cache-TTL / Aktualisierung | Offline |
|---|---|---|---|---|---|---|
| **NINA / MoWaS** (`nina`) | `https://warnung.bund.de/api31/mowas/mapData.json` + je Warnung `…/warnings/{id}.geojson` | CAP-JSON-Liste + GeoJSON-Polygone (N+1, im Backend kombiniert) | **Restriktiv: „nur nicht zu gewerblichen Zwecken".** Nutzung hier als nicht-gewerbliches behördliches/BOS-Lagetool; Quellennennung Pflicht. Inoffizielle API (bund.dev), keine Stabilitätszusage. | `Quelle: Bundesamt für Bevölkerungsschutz und Katastrophenhilfe (BBK) / MoWaS` | 90 s | leer + ausgegraut |
| **DWD** (`dwd`) | `https://maps.dwd.de/geoserver/dwd/ows` (WFS, `dwd:Warnungen_Gemeinden_vereinigt`, `outputFormat=application/json`, `EPSG:4326`) | GeoJSON-Polygone direkt | **GeoNutzV — offen, auch kommerziell**, Quellenvermerk Pflicht (bei veränderter Darstellung Zusatz „Datenbasis…"). | `Datenbasis: Deutscher Wetterdienst` | 300 s | leer + ausgegraut |
| **PEGELONLINE** (`pegelonline`) | `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeCurrentMeasurement=true` | JSON → GeoJSON-Punkte (~640 Pegel, Wasserstand) | **DL-DE→Zero 2.0** (keine Attributionspflicht, Quellenangabe empfohlen). | `PEGELONLINE / WSV` | 300 s (Messwerte ~15 min) | leer + ausgegraut |
| **Hochwasser-Meldeklassen / LHP** (`hochwasser`) | `https://www.hochwasserzentralen.de/` (Startseite, nur für den `ki`-Token) + `POST …/webservices/get_lagepegel.php` (`ki=<token>&pegelname=1`) | JSON-Struct-of-Arrays (`PGNAME`/`PGNR`/`HW`/`UNK`/`LAT`/`LON`, ~2070 Pegel) → GeoJSON-Punkte mit Meldeklasse | **Urheberrecht bei den jeweils zuständigen Hochwasserzentralen bzw. Pegelbetreibern der Länder**; Portal betrieben von LfU Bayern / LUBW Baden-Württemberg. Inoffizielle API (bund.dev), keine Stabilitätszusage. | `Länderübergreifendes Hochwasserportal (LHP) — Urheberrecht bei den zuständigen Hochwasserzentralen bzw. Pegelbetreibern der Länder` | 300 s | leer + ausgegraut |
| **Strahlung / ODL (BfS)** (`odl`) | `https://www.imis.bfs.de/ogc/opendata/ows` (WFS 1.1.0, `opendata:odlinfo_odl_1h_latest`, `outputFormat=application/json`) | GeoJSON-Punkte direkt (~1 676 ortsfeste Sonden, EPSG:4326, Gamma-ODL-Stundenwert in µSv/h) → auf die gelesenen Felder normalisiert, mit Bewertungsstufe | **GeoNutzV bzw. Datenlizenz Deutschland – Namensnennung – 2.0 (dl-de/by-2-0)**, auch kommerziell; Auflage laut BfS-Nutzungsbedingungen: Daten „in sachlicher Art und Weise darzustellen". Kein Schlüssel, keine dokumentierte Abrufgrenze. | `Bundesamt für Strahlenschutz (BfS), dl-de/by-2-0` | 600 s (Quelle im Stundentakt) | leer + ausgegraut |
| **Autobahn-Lage / BAB** (`autobahn`) | `https://verkehr.autobahn.de/o/autobahn/` (Streckenliste) + je Strecke `…/services/{webcam,roadworks,closure}` | JSON → GeoJSON-**Punkte** (111 Strecken × 3 Dienste, im Backend aggregiert) | **Kein Lizenzvermerk in API oder OpenAPI-Spec.** Gängige Einordnung (bundesAPI): Datenlizenz Deutschland – Namensnennung – 2.0 (dl-de/by-2-0), also auch kommerziell und verändert nutzbar bei Quellennennung. Kein Schlüssel, keine Registrierung. Siehe Lizenz-Vorbehalt unten. | `Autobahn GmbH des Bundes` | 600 s (Erstbefüllung im Hintergrund, s. u.) | leer + ausgegraut |
| **Luftqualität / UBA** (`luftqualitaet`) | `https://luftdaten.umweltbundesamt.de/api/air-data/v2/stations/json` + `…/airquality/json` (Acht-Stunden-Fenster, beide mit `lang=de&index=id`) | Zeilen-Arrays mit Spaltenliste in `indices` → GeoJSON-**Punkte** (~390 Messstationen mit Index) | **Lizenz-Vorbehalt, s. u.** — gängige Einordnung: Datenlizenz Deutschland – Namensnennung – 2.0 (dl-de/by-2-0). Kein Schlüssel, keine Registrierung. Inoffizielle API (bund.dev), keine Stabilitätszusage. | `Umweltbundesamt` | 900 s (Stundenwerte mit ~2 h Verzug) | leer + ausgegraut |
| **KRITIS / sensible Objekte** (`kritis`) | Deutschland-Extrakt `https://download.geofabrik.de/europe/germany-latest.osm.pbf` (Geofabrik, konfigurierbar), **kein Abruf je Anfrage** | OSM-PBF → eigener Bestand in `nachschlage-cache.db` (Nodes als Punkt, Ways/Relations als Bounding-Box-Mitte); Route liefert GeoJSON-Punkte je `bbox`, ab 5 000 Objekten Sammelpunkte | **ODbL** (OpenStreetMap), Attribution **zwingend**. | `© OpenStreetMap-Beitragende (ODbL)` | Import alle 168 h (`--kritis-extrakt-intervall-stunden`), Stand = `Last-Modified` des Extrakts | ohne Bestand leer + ausgegraut; ein vorhandener Bestand bleibt auch ohne Netz unbegrenzt gültig |
| **Energieanlagen** (`energie`, LFH-81) | OSM: `https://overpass-api.de/api/interpreter` (Mirror `overpass.kumi.systems`), `nwr[power=plant](bbox);out center tags;` · MaStR: `https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/GetErweiterteOeffentlicheEinheitStromerzeugung` (Filter: Nettonennleistung > 10 000 kW, Koordinate vorhanden, Status 35/37, `pageSize=2000`) | OSM-JSON + MaStR-JSON → GeoJSON-**Punkte**, je Anfrage über einen erweiterten Rand zusammengeführt und auf die `bbox` beschränkt | **ODbL** (OSM) · **Datenlizenz Deutschland – Namensnennung – 2.0** ([dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0)) für das [Marktstammdatenregister](https://www.marktstammdatenregister.de/MaStR) der Bundesnetzagentur | nur die beitragenden Teile, getrennt durch „ · “: `© OpenStreetMap-Beitragende (ODbL)` · `Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0` | 24 h je Teil (OSM je gerundeter bbox, MaStR bundesweit ein Eintrag); kalter Abruf von der Anfrage gelöst, Wartefrist 10 s für beide Teile zusammen; `stand` = Zeitpunkt des MaStR-Abzugs | ein Teil fällt aus → der andere wird gezeigt; beide aus → leer + ausgegraut |

## Hinweise zur Anbindung

- **NINA** ist die einzige Quelle mit einem zweistufigen Abruf (Übersichtsliste ohne
  Geometrie → Einzel-Geometrie je Warnung). Der Aggregator lädt die Geometrien parallel und
  toleriert einzelne fehlschlagende Geometrie-Abrufe (geloggt, übrige Warnungen bleiben).
- **KRITIS** und **Energie** sind die `bbox`-abhängigen Ebenen: Das Frontend meldet den
  Karten-Viewport (Parameter `bbox=west,sued,ost,nord`) nach Kartenbewegung (debounced), in
  jeder Zoomstufe. Fehlender/ungültiger `bbox` → HTTP 400. Die beiden gehen mit dem
  Ausschnitt verschieden um:
  - **KRITIS** fragt den eigenen Extrakt-Bestand, in jeder Zoomstufe und ohne Größengrenze
    (seit LFH-83; kein Cache je bbox nötig, kein Netzabruf). Details im Abschnitt „KRITIS aus
    dem OSM-Extrakt" unten.
  - **Energie** fragt Overpass weiter **live** je Ausschnitt und hat deshalb als einzige
    Ebene einen **Mindest-Zoom 10** (darunter keine Abfrage, Hinweis „näher heranzoomen")
    und eine **Größengrenze von 3° je Achse** (`karte::quellen::pruefe_energie_bbox`,
    größer → HTTP 400 „bbox zu groß — weiter hineinzoomen"; das Frontend prüft dieselbe
    Spanne vorab, `energieAusschnittPasst` in `pages/lagekarte/fachebenen.ts`, und zeigt dann
    den Zoom-Hinweis statt eine Anfrage zu schicken). Bis LFH-83 stand eine 1°-Grenze in
    `Bbox::parse` und galt für beide Ebenen; bei Zoom 10 ist ein Grad aber rund 1456 px
    breit, auf einem 1920-px-Schirm lehnte das Backend den Ausschnitt deshalb ab und die
    Ebene stand leer. Der Ausschnitt selbst ist derselbe geteilte, gerasterte Viewport wie
    bei KRITIS (EIN Raster für beide bbox-Ebenen, LFH-81) — der Aggregator cacht Energie je
    gerundeter bbox (der MaStR-Anteil bundesweit in einem Eintrag, s. u.). Für den
    Overpass-Abruf gilt ein eigenes Timeout von 30 s (`OVERPASS_TIMEOUT`), weil die Abfrage
    intern mit `[timeout:25]` läuft und damit über dem globalen 8-s-Client-Timeout liegt.
- **Energie (LFH-81) ist hybrid**, weil keine der beiden Quellen allein trägt. Gemessen am
  21.09.2026: das Marktstammdatenregister veröffentlicht für konventionelle Großkraftwerke
  **keine Koordinaten** (über 50 MW: 0 von 202 Erdgas-, 0 von 100 Kohle-, 0 von 25
  Mineralöl-Einheiten georeferenziert), Speicher, Solar, Wasser und Wind dagegen fast
  vollständig. Umspannwerke führt MaStR gar nicht (sie stehen als `power=substation` in
  KRITIS). Deshalb liefert OSM `power=plant` die Standorte samt der konventionellen Anlagen,
  MaStR die amtlich registrierten Großanlagen ab 10 MW. **Solange die Herkunft eines Punktes
  nur `osm` ist, ist seine Leistung eine OSM-Angabe und nicht amtlich** — für Kohle-, Gas-
  und Ölkraftwerke ist das mangels MaStR-Koordinaten der Regelfall.
- **Rauschfilter Energie:** aus OSM zählen nur `power=plant`; konventionelle Anlagen (Kohle,
  Gas, Öl, Kern, Abfall) immer, alle anderen nur mit getaggter Leistung **ab** 10 MW
  (`plant:output:electricity`, tolerant gelesen: `690 MW`, `1.2 GW`, `12000 kW`; `yes` oder
  `~50` gelten als unbekannt). Eine erneuerbare OSM-Anlage ohne Leistung erscheint nur, wenn
  ihr eine MaStR-Einheit zugeordnet wird. Ein Pumpspeicherwerk (`plant:source=hydro` mit
  `plant:method=water-pumped-storage`) zählt als **Speicher**, weil MaStR es so führt —
  sonst stünde es neben seinen eigenen Turbinen (gemessen am PSW Happurg: fünf Punkte statt
  einem). Aus MaStR kommen nur Einheiten **über** 10 MW, mit
  Koordinate, „In Betrieb“ oder „Vorübergehend stillgelegt“ — gefiltert beim Upstream,
  gemessen 1.267 Einheiten in einem Abruf (~7 s, ~5 MB).
- **Zusammenführung Energie:** eine MaStR-Einheit geht an die **nächste** OSM-Anlage
  **gleicher** Anlagenart im Umkreis von 2 km (`ENERGIE_RADIUS_M`, Messprotokoll im
  Commit von LFH-81); mehrere Einheiten summieren ihre Leistung, geführt werden Nummer und
  Id der größten; `mastr_nummern` nennt die Nummern aller Einheiten (sortiert, mit Komma
  ohne Leerzeichen, sonst `null`). Der Punkt bleibt am OSM-Standort, die Herkunft wird
  `osm+mastr`. Übrige MaStR-Einheiten erscheinen als eigene Punkte (`mastr`). Der Inspector
  verlinkt die Einheit über
  `https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/{mastr_id}`.
- **Rand des Ausschnitts Energie:** zusammengeführt wird nicht über die bbox, sondern über
  einen Rand darum — MaStR-Einheiten aus bbox + 2 × Radius, OSM-Anlagen aus bbox + 3 × Radius
  (die Overpass-Abfrage geht deshalb auf bbox + 6 km, der Cache-Schlüssel bleibt am
  gerundeten Original). Ausgegeben wird eine Anlage, wenn sie selbst oder eine ihr
  zugeordnete Einheit im Ausschnitt liegt; eine reine MaStR-Einheit, wenn sie darin liegt.
  Sonst entstand an der Kante ein eigener `mastr`-Punkt, und im Nachbarausschnitt kam
  dieselbe Anlage als `osm+mastr` hinzu — beim Verschieben der Karte doppelt. Ein
  zusammengeführter Punkt kann deshalb bis 2 km außerhalb der bbox stehen; er ist derselbe
  wie im Nachbarausschnitt.
- **Wartefrist Energie:** beide Teile werden bei kaltem Cache als eigene Task geholt, die
  Anfrage wartet zusammen höchstens 10 s (`ENERGIE_WARTE`) und antwortet mit dem, was da
  ist — das Frontend bricht nach 15 s ab, ein Warten auf den langsameren Teil ließ sonst die
  ganze Ebene offline wirken. Ein Teil, der die Frist reißt, wird in dieser Antwort nicht
  genannt, setzt aber keine Sperre; sein Abruf schreibt Cache bzw. Sperre danach zu Ende,
  auch wenn der Client inzwischen abgebrochen hat.
- **Der MaStR-JSON-Endpunkt ist inoffiziell** — öffentlich, aber nicht dokumentiert, ohne
  SLA und mit WAF davor. Der Filteroperator `gt` ist undokumentiert und arbeitet live
  numerisch; die Filterfeldnamen sind Anzeigenamen des Portals und können sich still ändern.
  Eine Antwort ohne `Data`-Liste oder ohne eine einzige Einheit gilt deshalb als
  **Fehlschlag**, nicht als Leerstand. Nach einem Fehlschlag ruht der Abruf fünf Minuten
  (`ENERGIE_MASTR_ABKUEHLUNG`), damit ein gestörtes Portal nicht jedes Verschieben der Karte
  bis zur Wartefrist aufhält und nicht jede Anfrage einen neuen Abzug startet; gesetzt wird
  sie nur von einem echten Fehlschlag, nicht von einer gerissenen Wartefrist; der letzte gute Stand wird über SWR weiter ausgeliefert (Cache-Aufbewahrung
  2 Tage), danach zeigt die Ebene nur den OSM-Anteil und die Quellennennung nennt nur noch
  OSM. **Ausweichweg**, falls der Endpunkt wegfällt: der
  [MaStR-Gesamtexport](https://www.marktstammdatenregister.de/MaStR/Datendownload) (XML, rund
  3 GB) oder der SOAP-Webdienst (Registrierung nötig).
- **LHP (`hochwasser`)** ist die zweite zweistufige Quelle — anders als NINA holt Stufe 1
  aber keine Daten, sondern einen **Sitzungs-Token**: die Webservices des Portals antworten
  nur mit einem gültigen, serverseitig ausgegebenen `ki`. Gemessen am 20.09.2026: ohne
  Parameter, mit erfundener Zahl oder mit dem Token eines anderen Aufrufs liefert
  `get_lagepegel.php` **HTTP 200 mit leerem Rumpf**, mit dem frisch aus der Startseite
  gelesenen Token ~138 KB. Der Token wird deshalb aus `addLagePegel(<ziffern>)` im
  Seitenquelltext gelesen (`karte::quellen::extrahiere_ki`) und steckt im selben
  Cache-Zyklus wie die Daten — zwei Zugriffe je Aktualisierung (TTL 300 s), nicht zwei je
  Nutzeranfrage. Bricht die Marke weg (Portalumbau), wird das geloggt und die Ebene geht
  auf `offline`; einen 5xx gibt es auch dann nicht.
- **Die Meldeklassen** stammen aus der Klassenlehre des Portals selbst
  (`js/lage-basics.js`, Kopfkommentar von `getColorLagePegel`): `-1` keine Daten/veraltet ·
  `0` kein Hochwasser · `1` kleines · `2` mittleres · `3` großes · `4` sehr großes
  Hochwasser. Das Flag `UNK = 1` kennzeichnet Pegel ohne Meldeklassen. Die Wire-Wörter der
  normalisierten `klasse` sind auf beiden Seiten gepinnt
  (`karte::normalisierung::hochwasser_tests` ↔ `pages/lagekarte/hochwasserStil.test.ts`);
  im OpenAPI-Schema stehen sie nicht, weil Fachebenen-Properties `HashMap<String, Value>`
  sind und ein registriertes Enum dort eine Waise wäre.
- **ODL (`odl`)** holt das ganze Messnetz mit **einem** WFS-Abruf. Gemessen am
  21.09.2026: HTTP 200, ~890 KB, ~1,1 s, 1 676 Sonden — davon 1 584 „in Betrieb" mit Wert,
  81 „defekt" und 11 „Testbetrieb", beide **ohne** Messwert und ohne Messende. Normalisiert
  (Kennung, Name, Wert, Einheit, Messende, Betriebsstatus, Stufe) bleiben ~358 KB (~36 KB
  gzip); eine bbox- oder Zoombegrenzung, wie sie KRITIS bis LFH-83 hatte, ist damit nicht nötig. Sonden ohne
  Messwert bleiben auf der Karte (Stufe `keine_messung`): eine ausgefallene Sonde ist in
  einer CBRN-Lage eine Lücke im Lagebild, die man sehen muss. Rund 70 Sonden standen zum
  Messzeitpunkt drei Stunden hinter dem aktuellen Stundenwert; das Messende steht deshalb
  im Detailpanel, eine eigene Stufe „veraltet" gibt es nicht. Eine Antwort **ohne
  `features`-Liste** (GeoServer-Fehlerbericht mit HTTP 200) gilt als Fehlschlag, nicht als
  „leer": die Ebene geht auf `offline`, ein vorhandener Stand bleibt stehen
  (`karte::quellen::odl_antwort`). Die Nachbar-Layer `odl_brutto_1h` und `odlinfo_sitelist`
  sind auf der BfS-Schnittstellenseite nicht dokumentiert und liefen im Test über 120 s —
  verwendet wird ausschließlich der dokumentierte Layer.
  Gestuft wird nur unter der Einheit `µSv/h`; meldete die Quelle eine andere, bleibt der
  Wert sichtbar und die Stufe ist `keine_messung` (sonst stünde nach einer Umstellung auf
  nSv/h das ganze Netz auf „stark erhöht"). Der Server liefert gzip (81 KB statt 890 KB),
  der Fachebenen-Client handelt es noch nicht aus — bei 8-s-Gesamtschranke kann der
  Kaltstart über eine schwache Mobilfunkverbindung `offline` ergeben (**LFH-599**).
- **Die ODL-Stufen sind eine Einteilung des Lifeline Hub, KEIN Schwellenwert des BfS.** Das
  BfS veröffentlicht keinen absoluten Wert für „erhöht". Es nennt 0,05–0,2 µSv/h als
  natürlichen Bereich in Deutschland, kurzzeitige Erhöhungen durch Regen „bis etwa einen
  Faktor 3" und einen Anlass zur Besorgnis erst bei längerer signifikanter Erhöhung „bzw.
  wenn die Erhöhung über einen Faktor 3 hinausgeht" — **standortbezogen** gemeint
  ([ODL-Info, Messwertinterpretation](https://odlinfo.bfs.de/ODL/DE/themen/wie-wird-gemessen/interpretation/interpretation.html)).
  Die Ebene bewertet deshalb **zweistufig** — beide Einteilungen sind Projekt-Entscheidungen
  (21.09.2026, LFH-78 und LFH-598):

  **Standortbezogen, sobald ein Grundpegel vorliegt (LFH-598).** Stufe nach dem Faktor
  Stundenwert ÷ Grundpegel der Sonde; die Grenze gehört zur unteren Stufe.

  | Stufe (`stufe`) | Faktor | Rolle | Wort |
  |---|---|---|---|
  | `normal` | ≤ 1,5 × | normal | unauffällig |
  | `erhoeht` | > 1,5 × bis ≤ 3 × | achtung | erhöht |
  | `stark_erhoeht` | > 3 × | alarm | stark erhöht |

  3 × ist der Faktor des BfS, hier so gemeint wie dort — standortbezogen. 1,5 × liegt über
  der normalen Streuung: in einer ruhigen Woche (Stichprobe 21.09.2026, 42 559 Werte) stand
  ein Wert bei 0,05 % der Fälle auf ≥ 1,5 × des Medians seiner Sonde, bei zwei Werten auf
  ≥ 2 ×. Regen fängt die Schwelle ein; das ist `achtung`, kein Alarm.

  **Absolut, solange keiner vorliegt (LFH-78)** — beim ersten Start, für Sonden mit zu
  wenig Historie und für Sonden in fremder Einheit:

  | Stufe (`stufe`) | Messwert | Rolle | Wort |
  |---|---|---|---|
  | `keine_messung` | kein Wert | neutral | keine Messung |
  | `normal` | ≤ 0,2 µSv/h | normal | unauffällig |
  | `erhoeht` | > 0,2 bis ≤ 0,6 µSv/h | achtung | erhöht |
  | `stark_erhoeht` | > 0,6 µSv/h (3 × Obergrenze) | alarm | stark erhöht |

  Die **Wörter nennen keinen Maßstab**, weil sie für beide Einteilungen stimmen müssen — eine
  Sonde mit 0,19 µSv/h und Faktor 3,2 liegt im natürlichen Bereich und ist trotzdem stark
  erhöht. Welche Einteilung gilt, trägt jedes Feature als `bewertung` (`standort` /
  `absolut`), bei `standort` mit `grundpegel`, `faktor` und `grundpegel_stand`; das
  Detailpanel nennt je Sonde den Maßstab und dass er keine BfS-Schwelle ist.

  **Woher der Grundpegel kommt.** Die frühere Aussage an dieser Stelle — ein Grundpegel sei
  nur über 1 676 Einzelabrufe zu haben — gilt für den Layer `odlinfo_timeseries_odl_24h`
  (eine Sonde je Abruf, `viewparams=kenn:…`). Der Nachbar-Layer
  **`opendata:odlinfo_timeseries_odl_1h`** hält dagegen die Stundenwerte **aller** Sonden der
  letzten sieben Tage (gemessen 21.09.2026: 263 687 Werte, ältester 167 h zurück) und nimmt
  einen `CQL_FILTER`. Einmal täglich holt das Backend damit eine Stichprobe von bis zu 28
  Zeitpunkten im 6-h-Raster in **einem** Abruf (gemessen ~8,6 MB, ~10 s, 1 585 Sonden) und
  bildet je Sonde das **untere Quartil** — ab **20** Werten, sonst bleibt die Sonde absolut.
  Das Quartil statt des Medians, weil es in einer mehrtägigen Lage später mitwandert (über
  fünf statt gut vier Tage), ohne Lage aber gemessen innerhalb von 1,5 % des Medians liegt.
  Eine **Sperrklinke** verwirft zusätzlich jede Neuberechnung, die den gespeicherten Pegel
  einer Sonde um 1,5 × oder mehr anheben würde; der alte Pegel bleibt samt Stand stehen —
  höchstens 14 Tage, danach wandert der Maßstab mit (sonst stünde etwa eine getauschte,
  empfindlichere Sonde für immer auf „erhöht"). Ein schleichender Anstieg knapp unter 1,5 ×
  je Tag kommt durch; das Quartil bremst ihn nur. Der Eintrag ist vom Prune des Caches
  (2 Tage) **ausgenommen**, damit eine länger gestörte Zeitreihe ihn nicht wegräumt.
  Der Abruf läuft **nur im Hintergrund** (angestossen vom ODL-Abruf, TTL 24 h, eigene
  90-s-Schranke, eine Stunde Abkühlung nach Fehlschlag) und hält die Ebene nie auf; eine
  unbrauchbare, leere oder nur für weniger als die Hälfte der bekannten Sonden gefüllte
  Antwort schreibt nichts (`karte::odl_grundpegel::neue_karte`).
  Abgelegt wird er im Fachebenen-Cache unter `odl:grundpegel`, bewertet wird bei Auslieferung
  (`karte::odl_grundpegel::bewerte`). Niederschlag rechnet die Ebene nicht heraus; der BfS
  führt dafür `odlinfo_timeseries_precipitation_15min`.
  Stufen- und Grundlagenwörter stehen in keinem OpenAPI-Schema und sind beidseitig gepinnt
  (`karte::normalisierung::odl_tests`, `karte::odl_grundpegel::tests` ↔
  `theme/statusFarben.test.ts`, `pages/lagekarte/odlStil.test.ts`).
- **Geltungsbereich ODL:** ausschließlich die ortsfesten Sonden des BfS-Messnetzes mit ihren
  Stundenwerten. Messungen von Messtrupps, Messfahrzeugen oder Hubschraubern im Einsatz sind
  **nicht** enthalten — die Zeile steht sichtbar unter dem Ebenen-Label.
- **Autobahn** ist die einzige Quelle mit einem **Fächer-Abruf**: die Streckenliste liefert die
  Autobahnen, danach werden je Strecke drei Dienste geholt (334 Abrufe, 8 gleichzeitig,
  Einzelfehler toleriert wie bei NINA). Gemessen am 20.09.2026: ein voller Lauf dauert ~25 s
  und liefert ~1,3 MB / ~2200 Punkte; bei 16 gleichzeitigen Abrufen drosselt die Quelle
  (30 statt 2 Fehlschläge), deshalb bleibt die Parallelität bei 8.
- **Autobahn ist auch die einzige Quelle, deren Lauf an KEINEM Request hängt** — und das ist
  keine Feinheit, sondern die Bedingung dafür, dass die Ebene überhaupt funktioniert. Ein
  blockierender 25-s-Lauf liefe in **zwei** Schranken, die beide vorher feuern: `apiGet`
  bricht im Frontend nach 15 s ab (`api/client.ts`), und `zulassung::REQUEST_BUDGET` kappt
  den Handler nach 60 s mit einem 503. Die Schranke in `zulassung.rs` trägt sogar die
  Begründung, die Routen mit ausgehendem Aufruf hätten „deutlich kürzere" eigene Timeouts und
  feuerten „immer zuerst" — ein blockierender Fächer bricht genau diese Zusage. Deshalb
  benutzt `fetch_autobahn` **nicht** `liefere_mit_swr`: bei kaltem Cache antwortet es sofort
  mit `offline` und füllt im Hintergrund.
  Praktisch heißt das: das erste Einschalten nach einem Backend-Start zeigt rund eine halbe
  Minute lang „offline", dann stehen die Daten. Das Frontend pollt währenddessen kurz
  getaktet (`aufwaermPollMs`, 20 s statt 600 s) — ohne das sähe der Bediener zehn Minuten
  lang nichts, obwohl die Daten längst da sind. **Die Aufwärmphase meldet also `offline`,
  obwohl die Quelle gerade geladen wird**; ein eigener Zwischenzustand dafür wäre eine
  Erweiterung des Fachebenen-Vertrags und ist bewusst nicht gebaut.
- **Nach einem gescheiterten Lauf ruht die Ebene fünf Minuten** (`AUTOBAHN_ABKUEHLUNG`).
  Ohne diese Sperre trommelte gerade der Aufwärmtakt eine ohnehin gestörte Quelle im
  Halbminutentakt mit je 333 Abrufen. Der Poll bleibt, er kostet dann eine winzige
  Leer-Antwort aus dem Backend statt eines Fächers. **Als Fehlschlag zählen zwei Türen, nicht
  eine:** die Quelle antwortet nicht (oder zu löchrig), **und** der Cache lässt sich nicht
  beschreiben (SQLite busy, Platte voll, read-only). Die zweite ist leicht zu übersehen, weil
  der Lauf selbst geglückt ist — sein Ergebnis IST aber der Cache-Eintrag, und ohne ihn
  beginnt derselbe Kreislauf. `cache::setze` meldet einen Schreibfehler deshalb zurück,
  statt ihn nur zu loggen; die übrigen Ebenen dürfen ihn weiter ignorieren, weil sie
  ihre Antwort im selben Request weiterreichen.
- **Geltungsbereich Autobahn:** ausschließlich Bundesautobahnen. Das steht als sichtbare Zeile
  unter dem Ebenen-Label in der Lagekarten-Leiste (nicht als Tooltip — ein Führungs-Tablet
  hat kein Hovern). Innerorts-, Kreis- und Landstraßensperrungen deckt die Quelle **nicht** ab;
  die Ebene ist Anfahrts-/Logistik-Hilfe und Lageaufklärung an der BAB, kein Sperrungs-Layer.
- **Autobahn — gemessene Eigenheiten der Quelle** (20.09.2026, Stand der Umsetzung):
  * Die Streckenliste führt `"A60 "` mit Leerzeichen **und** `"A60"`; der Abruf auf die
    Variante mit Leerzeichen liefert 0 Einträge. Der Adapter trimmt und entdoppelt deshalb,
    und lässt nur alphanumerische Namen durch (der Wert landet in einem URL-Pfad).
  * `isBlocked` stand über **alle** 1950 laufenden Baustellen und Sperrungen auf `"false"` —
    das Feld wird bewusst nicht übernommen.
  * Noch nicht begonnene Maßnahmen (`future: true`, rund 40 %) fallen weg.
  * **Der Webcam-Dienst ist derzeit leer.** Über alle 111 Strecken geprüft: `…/services/webcam`
    antwortet mit HTTP 200 und `{"webcam":[]}`. Die Kategorie ist vollständig gebaut (Bild-URL,
    Livebild-Link, Betreiber, Standbild-Vorschau im Detailpanel) und trägt, sobald die Quelle
    wieder liefert; im Moment zeigt die Ebene faktisch Baustellen und Sperrungen. Wer den
    Befund nachprüfen will, ruft den Dienst für eine beliebige Strecke ab.
  * Das **Webcam-Standbild lädt der Browser direkt beim Betreiber** (die Quelle liefert nur
    die URL, nicht das Bild) — anders als alle übrigen Fachebenen-Daten läuft es also NICHT
    über den Backend-Proxy. Ohne Internet am Gerät lädt es nicht; das Detailpanel blendet
    das Bild dann aus und nennt den Grund, statt ein kaputtes Bildsymbol stehen zu lassen.
- **Lizenz-Vorbehalt Autobahn:** weder die API noch die OpenAPI-Spec (bundesAPI) nennen eine
  Lizenz; die GovData-Eintragung „Die Autobahn App" zeigt im Suchergebnis keinen Lizenzwert.
  Die Pflicht-Attribution `Autobahn GmbH des Bundes` wird unabhängig davon immer mitgeführt
  und genügt damit auch der strengsten der in Frage kommenden Bedingungen. Vor einer
  kommerziellen Weiterverwertung ist die Lizenzlage direkt bei der Autobahn GmbH zu klären.
- **Luftqualität (UBA)** zeigt **Messpunkte, keine Fläche.** Die Ebene sagt, was an den
  Stationen des Luftmessnetzes gemessen wurde — nicht, wie die Luft zwischen ihnen oder am
  Einsatzort ist. Das steht als sichtbare Geltungszeile unter dem Ebenen-Label; eine
  Interpolation oder Ausbreitungsrechnung ist bewusst nicht gebaut, sie behauptete eine
  Messung, die es nicht gibt. Die Ebene ist Lageaufklärung (steigt die Belastung an den
  Stationen im Umfeld?), kein Ersatz für eigene Messtrupps.
- **Luftqualität — gemessene Eigenheiten der Quelle** (21.09.2026, alle per Abruf belegt):
  * **Host:** der in bundesAPI dokumentierte `https://www.umweltbundesamt.de/api/air_data/v2`
    antwortet mit **301** auf `https://luftdaten.umweltbundesamt.de/api/air-data/v2`
    (Bindestrich statt Unterstrich). Der Adapter spricht den finalen Host direkt an.
  * **Der Indexabruf treibt, nicht die Stationsliste:** `/stations` führt 2400 Stationen
    (1175 ohne Enddatum), `/airquality` liefert in einem einzigen Abruf den Index für ~390.
    Gezeichnet werden nur Stationen mit Index; die Liste liefert Koordinaten und Stammdaten.
    Zwei Abrufe je Aktualisierung (~560 KB + ~210 KB), scheitert einer, gilt der Lauf als
    gescheitert und der letzte gute Cache-Stand bleibt.
  * **Zeit ist MEZ ohne Sommerzeit.** `indices` sagt wörtlich `date start (CET)`; ein Abruf um
    11:39 MESZ lieferte als jüngste Stunde den Start 08:00. Umgerechnet wird deshalb mit festem
    `+01:00`, nicht mit `Europe/Berlin` (sonst läge jeder Sommerwert eine Stunde daneben). Das
    Ende der letzten Tagesstunde heißt in der Quelle `…-20 24:00:00` und wird zu 00:00 des
    Folgetags. Der Messzeitpunkt einer Station ist das **Ende** ihrer Messstunde.
  * **Verzug:** die jüngste Stunde endet ~1,5–2,5 h vor dem Abruf, einzelne Stationen hängen
    eine weitere Stunde zurück. Deshalb das Acht-Stunden-Fenster und TTL 900 s statt 3600 s
    (eine Stunde TTL legte eine weitere Stunde auf den Verzug). Weil das Fenster mit der
    laufenden, also noch leeren Stunde endet, bleiben davon rund fünf Stunden Daten — Reserve für
    Nachzügler und einen Importausfall der Quelle von etwa vier Stunden. Der Inspector zeigt den
    Messzeitpunkt immer — ein Wert ohne Zeit läse sich als „jetzt".
  * **Das `request.index`-Echo ist unzuverlässig:** bei tagesübergreifenden Fenstern meldet es
    `code`, auch mit explizitem `index=id`, während die Schlüssel numerische IDs bleiben. Der
    Adapter löst deshalb über ID **und** Stationscode auf — eine reine ID-Auflösung bliebe bei
    einem echten Umschalten still leer.
  * **Indexskala 0–4, 0 = „sehr gut".** Gegen die UBA-Klassengrenzen geprüft (NO₂ 0–20 → 0,
    21–40 → 1, 41–54 → 2; O₃ 0–60 → 0, 61–90 → 1). Wire-Wörter der normalisierten `klasse`:
    `sehr_gut`/`gut`/`maessig`/`schlecht`/`sehr_schlecht`/`keine_daten`, gepinnt in
    `karte::luftqualitaet::tests` ↔ `theme/statusFarben.test.ts`.
  * **„Unvollständig" bei gut der Hälfte:** 209 von 388 Stundenwerten tragen die Kennzeichnung
    der Quelle, dass der Index aus weniger Komponenten gebildet ist. Die Ebene zeigt das als
    Wort im Inspector, nicht als Farbe und nicht als Filter — es bleibt die amtliche Einstufung.
  * **Leitschadstoff** = Komponente mit dem höchsten Teilindex, bei Gleichstand der höhere
    `y`-Wert (gemessen: Wert relativ zur Obergrenze der „sehr gut"-Klasse, also über
    Komponenten vergleichbar). Im Index kommen gemessen NO₂, O₃ und PM10 vor.
  * **Live-Abgleich** (21.09.2026, 12:00 MESZ): 388 Stationen, `stand` 09:00 MEZ;
    Stichprobe DENI143 (Oldenburg Heiligengeistwall, ID 1025) roh Index 1, NO₂ 31 (Teilindex 1),
    PM10 15, unvollständig — die Ebene zeigt „gut", Leitschadstoff NO₂, dieselben Werte.
- **Lizenz-Vorbehalt Luftqualität:** weder die API noch die Luftdaten-Seiten des UBA nennen eine
  Lizenz. Die Einordnung als Datenlizenz Deutschland – Namensnennung – 2.0 stammt aus
  Sekundärquellen (GDI-DE-Metadatensatz „Luftdaten Deutschland API", Open-Data-Katalog der
  Stadt Oldenburg). Die Pflicht-Attribution `Umweltbundesamt` wird unabhängig davon immer
  mitgeführt. Vor einer kommerziellen Weiterverwertung ist die Lizenzlage direkt beim UBA zu
  klären.
- **Luftbild** ist bewusst **keine** Fachebene, sondern gehört als weiterer benannter
  Online-Style in die Server-`KarteConfig` (`online_styles`), da es eine Basiskarte (Raster)
  und kein Overlay ist.

## Bewusst zurückgestellt (v1)

- **LHP-Pegeldetails (`get_infospegel.php`):** liefert Wasserstand, Gewässer und Zeitpunkt
  je Pegel — aber nur als **Einzelabruf** und ebenfalls nur gegen einen gültigen `ki`. Für
  ~2070 Pegel wäre das ein N+1 gegen ein Behördenportal; das Akzeptanzkriterium („Pegel mit
  aktiver Meldestufe sichtbar und unterscheidbar") trägt `get_lagepegel.php` allein. Wer die
  Zentimeter braucht, schaltet die PEGELONLINE-Ebene daneben ein — genau diese
  Arbeitsteilung ist der Zweck der Ebene: dort der rohe Messwert, hier die amtliche
  Bewertung.
- **LHP-Gebietsflächen (`bundesland.{version}.geojson` + `get_infosbundesland.php`):** im
  Ticket als „optional" geführt und zurückgestellt. Die Geometrie ist ein statisches
  GeoJSON mit **datierter Dateiversion** im Pfad (z. B. `bundesland.20220405.geojson`) —
  ein einkompilierter Pin verrottet still, sobald das Portal eine neue Fassung ausliefert.
  Die zugehörigen Lagewerte je Bundesland hängen wieder am `ki`. Eigene Entscheidung, kein
  Nebenprodukt dieser Anbindung.
- **Störfallbetriebe (Seveso):** kein bundesweiter, frei nutzbarer Geodatensatz (EEA/eSPIRS
  zugangsbeschränkt, PRTR ≠ Seveso, nur heterogene Länder-WFS ohne CORS).
- **Stromversorgung/Stromausfälle:** keine bundesweit offene Geo-API (nur iframe-Portale).
- **Verkehr abseits der BAB:** die Bewertung aus v1 gilt unverändert — die offene Autobahn-API
  deckt nur Bundesautobahnen ab, nicht die einsatzrelevanten lokalen Sperrungen;
  Mobilithek/DATEX II ist registrierungs-/zertifikatsbasiert. **Was seit LFH-80 da ist**, ist
  genau der eng gefasste Rest: die BAB-Ebene oben als Anfahrts-/Logistik-Hilfe und für die
  Lageaufklärung an der Autobahn. Ein flächendeckender Sperrungs-Layer bleibt zurückgestellt.

## KRITIS aus dem OSM-Extrakt (LFH-83)

Bis LFH-83 fragte die Route je Karten-Ausschnitt die öffentliche Overpass-API ab — erst ab
Zoom 10, höchstens 1° × 1°, gesammelt auf höchstens 4 000 Punkte. Bundesweit war die Ebene
damit nicht zu sehen, und jeder neue Ausschnitt war eine weitere Anfrage an eine fremde
Fair-Use-Instanz. Jetzt:

- **Quelle:** der Deutschland-Extrakt von Geofabrik (`germany-latest.osm.pbf`, am
  21.09.2026 4,84 GB, Geofabrik leitet auf Spiegel wie `ftp5.gwdg.de` um). Die URL ist über
  `--kritis-extrakt-url` / `LIFELINE_KRITIS_EXTRAKT_URL` auf einen eigenen Spiegel
  umstellbar (nur https).
- **Auswahl:** exakt die Tags der früheren Overpass-Query — `amenity=hospital|clinic`
  (Krankenhaus), `amenity=nursing_home` und `social_facility=*` (Pflege),
  `amenity=school|kindergarten` (Schule/Kita), `man_made=water_works|water_tower` (Wasser),
  `power=substation` (Umspannwerk), `amenity=fire_station` (Feuerwehr), `amenity=police`
  (Polizei). Flächen (Ways, Multipolygon-Relations) werden zur Mitte ihrer Bounding-Box,
  wie Overpass `out center`.
- **Takt:** Default-an in jeder Instanz, **auch im Dev-Stack**. 60 s nach dem Start, danach
  stündlich wird geprüft, ob der Bestand älter als das Intervall ist (Vorgabe 168 h,
  `--kritis-extrakt-intervall-stunden`). Vor dem Download ein `HEAD`: gleiche `ETag`
  bzw. `Last-Modified` → kein Download, nur der Zeitpunkt wird fortgeschrieben. Die Datei
  liegt nur während des Imports unter `<karten-dir>/kritis/` und wird danach immer gelöscht.
- **Abschalten:** `--kritis-extrakt false` / `LIFELINE_KRITIS_EXTRAKT=false`. So startet die
  Playwright-Suite; ohne früheren Bestand meldet die Ebene dann `offline`.
- **Ausfall:** Scheitert ein Lauf (Netz, Platte, kaputte Datei, Extrakt ohne ein einziges
  Objekt), bleibt der bisherige Bestand samt `stand` stehen, und der nächste stündliche Tick
  versucht es erneut. Getauscht wird atomar über Staging-Tabellen.
- **Stand:** `stand` in der Antwort ist das `Last-Modified` der Extrakt-Datei (RFC 3339), wie
  der ausliefernde Spiegel es meldet — nicht der Abrufzeitpunkt. Geofabrik baut den Extrakt
  täglich, der Wert liegt also nahe am OSM-Datenstand; exakt wäre der
  `osmosis_replication_timestamp` im PBF-Kopf, den der Import nicht liest.
- **Fehlschläge:** Scheitert ein Lauf erst beim oder nach dem Download, wird frühestens nach
  6 h erneut geladen (`FEHLER_ABSTAND`) — sonst lüde jeder stündliche Tick die 4–5 GB neu.
  Eine Zeitsperre statt eines Header-Vergleichs, weil die Spiegel unterschiedliche `ETag`s
  melden. Ein gescheitertes `HEAD` (kein Netz) sperrt nicht.
- **Verdichtung:** Liegen mehr als 5 000 Objekte im Ausschnitt, liefert die Route
  Sammelpunkte (`sammelpunkt: true`, `anzahl`) aus einem fest am Nullmeridian/Äquator
  verankerten Raster (0,01° bis 20°, kleinste Weite mit höchstens 5 000 Zellen). Die Zellen
  werden beim Import je Rasterstufe vorberechnet (`kritis_zelle`). Eine Zelle zählt immer
  ganz, damit Bündel beim Pannen nicht ihre Zahl ändern. Die Karte bündelt Einzelobjekte
  und Sammelpunkte zusätzlich selbst (`cluster: true`, Zahl = Summe der `anzahl`).

**Messung am echten Extrakt** (21.09.2026, Stand `Mon, 21 Sep 2026 01:43:18 GMT`,
Release-Build, Apple Silicon, 16 Kerne):

| Größe | Wert |
|---|---|
| KRITIS-Objekte | 263 394 (Node 76 535 · Way 184 560 · Relation 2 299) |
| je Kategorie | Umspannwerk 107 616 · Schule/Kita 82 584 · Feuerwehr 29 164 · Pflege 25 895 · Wasser 9 203 · Krankenhaus 5 039 · Polizei 3 893 |
| Einlesen, alle 16 Kerne | 50 s, Spitze **3,6 GB** RSS |
| Einlesen, 4 Threads (so läuft der Import) | ~185 s, Spitze ~0,6 GB RSS |
| Tausch inkl. Zellen | 8 s |
| Cache-DB danach | 81 MB |
| Abfrage DE / NRW / Köln | 47 ms (1 290 Sammelpunkte) · 15 ms (2 871) · 17 ms (1 490 Einzelobjekte) |

Der Import läuft deshalb in einem eigenen Pool mit **4 Threads**: dreimal so lang, aber
ein Sechstel des Speichers, und die übrigen Kerne bleiben dem Einsatzbetrieb. Im Dev-Build
sind `osmpbf`, `protobuf`, `flate2` und `miniz_oxide` optimiert übersetzt
(`[profile.dev.package.*]` in `Cargo.toml`), weil der Import auch dort Default-an ist.

**Abhängigkeit `osmpbf`:** zieht `memmap2` 0.5.10 mit, für das `cargo audit` seit
Einführung RUSTSEC-2026-0186 („unsound": ungeprüfter Zeiger-Offset) als **erlaubte Warnung**
meldet. Der Import liest über `ElementReader::from_path` (gepufferter Dateileser), nicht über
den mmap-Weg der Crate; die betroffene Funktion wird nicht aufgerufen. Neu bewerten, wenn
jemand auf `Mmap`/`from_mmap` umstellt oder `osmpbf` eine Version mit neuerem `memmap2`
bringt.

**Grenzen:** Das ist keine amtliche KRITIS-Liste, sondern, was in OSM getaggt ist — Lücken
und Fehlklassifikationen der Quelle werden übernommen (`social_facility=*` ist breit und
bewusst unverändert aus der Overpass-Zeit übernommen). Der Geltungshinweis im Panel sagt
das sichtbar.

