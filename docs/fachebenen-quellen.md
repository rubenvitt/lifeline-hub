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
| **Autobahn-Lage / BAB** (`autobahn`) | `https://verkehr.autobahn.de/o/autobahn/` (Streckenliste) + je Strecke `…/services/{webcam,roadworks,closure}` | JSON → GeoJSON-**Punkte** (111 Strecken × 3 Dienste, im Backend aggregiert) | **Kein Lizenzvermerk in API oder OpenAPI-Spec.** Gängige Einordnung (bundesAPI): Datenlizenz Deutschland – Namensnennung – 2.0 (dl-de/by-2-0), also auch kommerziell und verändert nutzbar bei Quellennennung. Kein Schlüssel, keine Registrierung. Siehe Lizenz-Vorbehalt unten. | `Autobahn GmbH des Bundes` | 600 s | leer + ausgegraut |
| **KRITIS / sensible Objekte** (`kritis`) | `https://overpass-api.de/api/interpreter` (Overpass QL, `nwr … out center`) | OSM-JSON → GeoJSON-Punkte (Zentroide), viewport-`bbox`-getrieben | **ODbL** (OpenStreetMap), Attribution **zwingend**. | `© OpenStreetMap-Beitragende (ODbL)` | 3600 s (KRITIS-Objekte ändern sich kaum) | leer + ausgegraut |

## Hinweise zur Anbindung

- **NINA** ist die einzige Quelle mit einem zweistufigen Abruf (Übersichtsliste ohne
  Geometrie → Einzel-Geometrie je Warnung). Der Aggregator lädt die Geometrien parallel und
  toleriert einzelne fehlschlagende Geometrie-Abrufe (geloggt, übrige Warnungen bleiben).
- **KRITIS** ist die einzige `bbox`-abhängige Ebene: Das Frontend meldet den Karten-Viewport
  (Parameter `bbox=west,sued,ost,nord`) nach Kartenbewegung (debounced); der Aggregator cacht
  pro gerundeter bbox. Fehlender/ungültiger `bbox` → HTTP 400.
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
- **Autobahn** ist die einzige Quelle mit einem **Fächer-Abruf**: die Streckenliste liefert die
  Autobahnen, danach werden je Strecke drei Dienste geholt (334 Abrufe, 8 gleichzeitig,
  Einzelfehler toleriert wie bei NINA). Gemessen am 20.09.2026: ein voller Lauf dauert ~25 s
  und liefert ~1,3 MB / ~2200 Punkte; bei 16 gleichzeitigen Abrufen drosselt die Quelle
  (30 statt 2 Fehlschläge), deshalb bleibt die Parallelität bei 8. Ein Gesamtdeckel von 60 s
  begrenzt den **kalten** (blockierenden) Pfad; danach trägt der SWR-Cache. Praktisch heißt
  das: das erste Einschalten nach einem Backend-Start zeigt rund eine halbe Minute den
  Lade-Spinner in der Fachebenen-Liste, jedes weitere Laden ist sofort da.
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
