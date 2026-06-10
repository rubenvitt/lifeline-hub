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
| **KRITIS / sensible Objekte** (`kritis`) | `https://overpass-api.de/api/interpreter` (Overpass QL, `nwr … out center`) | OSM-JSON → GeoJSON-Punkte (Zentroide), viewport-`bbox`-getrieben | **ODbL** (OpenStreetMap), Attribution **zwingend**. | `© OpenStreetMap-Beitragende (ODbL)` | 3600 s (KRITIS-Objekte ändern sich kaum) | leer + ausgegraut |

## Hinweise zur Anbindung

- **NINA** ist die einzige Quelle mit einem zweistufigen Abruf (Übersichtsliste ohne
  Geometrie → Einzel-Geometrie je Warnung). Der Aggregator lädt die Geometrien parallel und
  toleriert einzelne fehlschlagende Geometrie-Abrufe (geloggt, übrige Warnungen bleiben).
- **KRITIS** ist die einzige `bbox`-abhängige Ebene: Das Frontend meldet den Karten-Viewport
  (Parameter `bbox=west,sued,ost,nord`) nach Kartenbewegung (debounced); der Aggregator cacht
  pro gerundeter bbox. Fehlender/ungültiger `bbox` → HTTP 400.
- **Luftbild** ist bewusst **keine** Fachebene, sondern gehört als weiterer benannter
  Online-Style in die Server-`KarteConfig` (`online_styles`), da es eine Basiskarte (Raster)
  und kein Overlay ist.

## Bewusst zurückgestellt (v1)

- **Störfallbetriebe (Seveso):** kein bundesweiter, frei nutzbarer Geodatensatz (EEA/eSPIRS
  zugangsbeschränkt, PRTR ≠ Seveso, nur heterogene Länder-WFS ohne CORS).
- **Stromversorgung/Stromausfälle:** keine bundesweit offene Geo-API (nur iframe-Portale).
- **Verkehr:** offene Autobahn-API deckt nur Bundesautobahnen ab, nicht die einsatzrelevanten
  lokalen Sperrungen; Mobilithek/DATEX II ist registrierungs-/zertifikatsbasiert.
