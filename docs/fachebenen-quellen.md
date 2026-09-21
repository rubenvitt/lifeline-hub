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
| **KRITIS / sensible Objekte** (`kritis`) | `https://overpass-api.de/api/interpreter` (Overpass QL, `nwr … out center`) | OSM-JSON → GeoJSON-Punkte (Zentroide), viewport-`bbox`-getrieben | **ODbL** (OpenStreetMap), Attribution **zwingend**. | `© OpenStreetMap-Beitragende (ODbL)` | 86400 s = 1 Tag (KRITIS-Objekte sind quasi statisch, entlastet Overpass) | leer + ausgegraut |

## Hinweise zur Anbindung

- **NINA** ist die einzige Quelle mit einem zweistufigen Abruf (Übersichtsliste ohne
  Geometrie → Einzel-Geometrie je Warnung). Der Aggregator lädt die Geometrien parallel und
  toleriert einzelne fehlschlagende Geometrie-Abrufe (geloggt, übrige Warnungen bleiben).
- **KRITIS** ist die einzige `bbox`-abhängige Ebene: Das Frontend meldet den Karten-Viewport
  (Parameter `bbox=west,sued,ost,nord`) nach Kartenbewegung (debounced); der Aggregator cacht
  pro gerundeter bbox. Fehlender/ungültiger `bbox` → HTTP 400. Jeder dieser bbox-Einträge
  hält **einen Tag** (`karte::quellen::KRITIS_TTL` = 24 × 3600 s) — deutlich länger als bei
  jeder anderen Ebene, weil Krankenhäuser, Schulen und Umspannwerke quasi statisch sind und
  ein kurzer Takt bei jedem Kartenschwenk eine neue bbox gegen Overpass laufen ließe. Dazu
  kommt ein eigenes Abruf-Timeout von 30 s (`KRITIS_TIMEOUT`), weil die Overpass-Abfrage
  intern mit `[timeout:25]` läuft und damit über dem globalen 8-s-Client-Timeout liegt.
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
  gzip); eine bbox- oder Zoombegrenzung wie bei KRITIS ist damit nicht nötig. Sonden ohne
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
  Die Ebene bildet daraus absolute Bänder (Entscheidung mit dem Menschen, 21.09.2026):

  | Stufe (`stufe`) | Messwert | Rolle | Wort |
  |---|---|---|---|
  | `keine_messung` | kein Wert | neutral | keine Messung |
  | `normal` | ≤ 0,2 µSv/h | normal | im natürlichen Bereich |
  | `erhoeht` | > 0,2 bis ≤ 0,6 µSv/h | achtung | über natürlichem Bereich |
  | `stark_erhoeht` | > 0,6 µSv/h (3 × Obergrenze) | alarm | über 3 × natürlicher Obergrenze |

  Das Detailpanel jeder Sonde sagt das mit einem eigenen Satz, die Wörter beschreiben die
  Lage zum natürlichen Bereich und keine Gefährdung. **Bekannte Schwäche:** Regen hebt
  Sonden in Gebieten mit hohem Grundpegel zeitweise über 0,2 µSv/h; schon am Messtag
  standen zwei Sonden ohne jede Lage knapp darüber. Umgekehrt fällt eine Verdreifachung an
  einer Sonde mit niedrigem Grundpegel nicht auf. Eine **standortbezogene** Bewertung
  scheitert an der Schnittstelle: die Zeitreihe `odlinfo_timeseries_odl_24h` ist eine
  parametrisierte Sicht, die **eine Sonde je Abruf** liefert (`viewparams=kenn:…`, 365
  Tageswerte) — für das ganze Netz 1 676 Abrufe. Das ist als **LFH-598** festgehalten.
  Die Stufenwörter stehen wie die LHP-Klassen in keinem OpenAPI-Schema und sind beidseitig
  gepinnt (`karte::normalisierung::odl_tests` ↔ `theme/statusFarben.test.ts`,
  `pages/lagekarte/odlStil.test.ts`).
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
