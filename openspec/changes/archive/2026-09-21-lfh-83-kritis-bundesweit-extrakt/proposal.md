# Proposal

## Why

Die KRITIS-Fachebene (Krankenhäuser, Pflege, Schulen/Kitas, Wasser, Umspannwerke,
Feuerwehr, Polizei) gibt es heute schon — aber nur **ausschnittsweise**: das Backend fragt
je Karten-Viewport die öffentliche Overpass-API ab, erst ab Zoom 10 und höchstens 1° × 1°,
und das Frontend sammelt die Treffer auf höchstens 4 000 Punkte. Bundesweit sieht man
damit nichts, und jeder neue Ausschnitt ist eine weitere Anfrage an eine fremde, oft
überlastete Fair-Use-Instanz. Ein Führungsgerät soll KRITIS für ganz Deutschland zeigen
können, auch beim Rauszoomen, ohne dass der Betrieb an der Verfügbarkeit von Overpass hängt.

## What Changes

- **Neue Datenbasis:** Das Backend lädt periodisch den Deutschland-OSM-Extrakt
  (`germany-latest.osm.pbf`, Geofabrik), zieht daraus die KRITIS-Objekte (Nodes, Ways,
  Relations → Punkt) und legt sie in einer eigenen Tabelle der Nachschlage-Cache-DB ab.
  Dieselben Kategorien und Properties wie heute (`kategorie`, `titel`, `adresse`,
  `betreiber`, `telefon`, `website`, `notaufnahme`).
- **Hintergrund-Job, Default AN:** Der Import läuft in jeder normal gestarteten Instanz,
  auch im Dev-Stack. Abschaltbar per Konfiguration (für Tests und die e2e-Suite);
  Intervall und Extrakt-URL sind konfigurierbar. Ein fehlgeschlagener Lauf lässt den
  bisherigen Bestand stehen.
- **Route `GET /api/karte/fachebenen/kritis`:** liefert aus dem Bestand statt aus
  Overpass, für **jede** gültige bbox bis hin zu ganz Deutschland. Bei mehr als 5 000
  Objekten im Ausschnitt liefert sie serverseitig verdichtete Sammelpunkte statt
  Einzelobjekten. `stand` nennt den Datenstand des Extrakts.
- **BREAKING (intern):** Die Overpass-Abfrage für KRITIS entfällt ersatzlos, ebenso die
  1°-Begrenzung der bbox und im Frontend Mindest-Zoom 10, Akkumulation und 4 000er-Deckel.
  Ohne importierten Bestand (Aufwärmphase, abgeschalteter Import) meldet die Ebene
  `offline`.
- **Frontend-Clustering:** Die KRITIS-Quelle wird eine MapLibre-GeoJSON-Quelle mit
  `cluster: true`; Sammelpunkte tragen ihre Anzahl sichtbar. Klick auf einen Sammelpunkt
  zoomt hinein, Klick auf ein Einzelobjekt öffnet wie bisher das Detail-Panel.
- ODbL-Attribution „© OpenStreetMap-Beitragende (ODbL)" bleibt; die Quellendokumentation
  (`docs/fachebenen-quellen.md`) nennt Quelle, Stand, Intervall und Lizenz neu.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `lagekarte-fachebenen`: bekommt Anforderungen für die KRITIS-Ebene — bundesweite
  Abrufbarkeit ohne Overpass, periodischer Extrakt-Import mit Abschaltbarkeit,
  Verdichtung und Clustering, Klickverhalten, Offline-Verhalten und Quellennennung.

## Impact

- **Backend:** `src/karte/quellen.rs` (KRITIS-Overpass-Pfad entfällt),
  `src/karte/normalisierung.rs` (Kategorie-/Property-Logik wird auf OSM-Tags statt
  Overpass-JSON umgestellt und von beiden Seiten genutzt), neues Modul für Import und
  Bestand, `src/cache_db.rs` (Schema), `src/config.rs` + `src/main.rs` (Schalter,
  Scheduler-Start), `src/routes/karte.rs` (Route), `src/karte/typen.rs` (bbox-Regeln).
- **Neue Abhängigkeit:** Rust-Crate `osmpbf` (reiner Rust-PBF-Parser; Single-Binary
  bleibt). Lizenz und Advisories laufen durch `check-deps.sh`.
- **Betrieb:** je Lauf ein Download von rund 4–5 GB und einige Minuten CPU; die Datei
  liegt nur während des Imports im Karten-Datenverzeichnis. Der Bestand selbst ist
  eine Tabelle von grob einigen hunderttausend Zeilen in `nachschlage-cache.db`.
- **Frontend:** `pages/lagekarte/fachebenen.ts`, `fachebenenLayer.ts`, `useFachebenen.ts`,
  `Kartenflaeche.tsx`, `LagekartePage.tsx`, `api/fachebenen.ts`.
- **e2e:** `frontend/playwright.config.ts` startet das Backend mit abgeschaltetem Import.
- **API:** Parameter unverändert (`bbox`); die Antwortform (Fachebenen-Umschlag) bleibt,
  Features können zusätzlich Sammelpunkte (`sammelpunkt`, `anzahl`) sein.
