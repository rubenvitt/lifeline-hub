# Karten-Verwaltung im Admin-UI — Design & Task-Schnitt

**Status:** Abgenommen (Scoping abgeschlossen) · **Datum:** 2026-06-26 · **Board:** LFH-31
(Scoping/Design-Doc) · Umsetzung im eigenen Epic **LFH-178 „Karten-Verwaltung im Admin-UI"**

> Dieses Dokument ist das Ergebnis des Scopings von LFH-31. LFH-31 wird auf „Design-Doc +
> Task-Schnitt" umgewidmet; die eigentliche Umsetzung wird in mehrere Tasks unter dem Epic
> aufgeteilt (siehe [Task-Schnitt](#clickup-task-schnitt-umgesetzt)).

## Problem / Motivation

Heute kommt die gesamte Kartenkonfiguration **ausschließlich aus ENV/CLI** und wird beim
Serverstart gelesen und als `Extension` (`KarteConfig`) injiziert — **zur Laufzeit read-only**:

- **Offline-Basemap:** genau **eine** PMTiles-Datei an `LIFELINE_PMTILES_PATH`, vom Server per
  HTTP-Range unter `/api/karte/tiles.pmtiles` ausgeliefert (`src/routes/karte.rs`, `src/app.rs`).
- **Online-Styles:** statische Liste aus `LIFELINE_KARTE_STYLES` / `LIFELINE_KARTE_STYLE_URL`
  bzw. eine eingebaute schlüsselfreie Shortlist (`default_online_styles()` in `src/config.rs`).
- **Keine Admin-UI** für Karten.

**Ziel:** Karten — online wie offline — über die **App-Admin-Oberfläche** verwalten:
kuratierter Vorschlagskatalog, eigene Quellen hinzufügen, Offline-Karten **herunterladen** und
**aktualisieren**. Die Admin-Oberfläche ist dabei **nicht nur fürs Feld** gedacht.

## Schlüssel-Reframe: zwei Lebenszyklus-Phasen

Das Deployment trennt zwei Phasen streng, und das löst den scheinbaren Widerspruch
„Download im Feld ohne Netz" auf:

- **Prep-/Build-Phase** (MIT Netz, Admin-UI auf verbundenem Rechner): Karten beschaffen,
  herunterladen, konfigurieren, aktualisieren.
- **Betrieb-Phase** (ELW, OHNE Netz): Karten ausliefern (HTTP-Range — fertig) + anzeigen
  (Switcher — fertig).

Weil die **Admin-UI eine Prep-Phasen-Fläche** ist (verbundener Rechner, nicht das Funkloch),
ist „Karten in der Admin-UI herunterladen/aktualisieren" **kohärent**: Das **Binary selbst**
lädt die Tiles bei Netz, legt sie lokal ab und serviert sie später im Feld per HTTP-Range.

## Architektur-Entscheidung: in-App, kein externer Tile-Service

**Entscheidung: alles in-App, kein ausgelagerter Karten-/Tile-Service (kein Docker-Compose).**
Kein knappes Rennen.

| | in-App (Status quo erweitert) | externer Tile-Service (Docker Compose) |
|---|---|---|
| Deployment | eine Binary, rust-embed, keine Laufzeit-Deps, Kopie-auf-ELW | erzwingt Docker auf dem Feld-ELW |
| Fehlerfläche im Feld | minimal (genau das ist die Sicherheitseigenschaft) | zusätzliche Dienste/Compose-Orchestrierung |
| Tile-Serving | PMTiles = ein File, HTTP-Range — **bereits implementiert** | Tile-Server (TileServer-GL/Martin) nötig |
| Nutzen des Auslagerns | — | nur bei dynamischer Tile-Generierung aus Roh-OSM **zur ELW-Laufzeit** |

**Begründung:** Single-Binary ist hier die Sicherheitseigenschaft. PMTiles existiert genau
dafür, **keinen** Tile-Server zu brauchen — eine einzelne Datei, vom „dummen" HTTP-Range-Server
ausgeliefert (schon vorhanden). Ein externer Dienst lohnte sich nur, wenn man zur ELW-Laufzeit
dynamisch Tiles aus Roh-OSM generieren müsste — muss man nicht, Beschaffung ist Build-/Prep-Zeit.
Auslagern brächte also nur Kosten und Fehlerfläche, keinen Nutzen.

## Grundstein: Kartenkonfig von ENV-only → laufzeit-schreibbar (DB-gestützt)

Der gemeinsame Knackpunkt, den **beide** Funktionsabschnitte brauchen: Die Kartenkonfig muss von
„ENV-only, beim Start gelesen" auf **laufzeit-schreibbar** umgestellt werden.

- **DB-gestützte Registry** für (a) Online-Quellen und (b) Offline-Karten.
- **Admin-Endpunkte** (CRUD) hinter Admin-Auth.
- **Karte-Routen lesen zur Laufzeit aus der DB** statt aus der injizierten `KarteConfig`.
- **Daten-Verzeichnis** für heruntergeladene Karten (z. B. `<db-dir>/karten/`); der feste
  `LIFELINE_PMTILES_PATH` weicht einem verwalteten Verzeichnis.
- **Rückwärtskompatibel:** vorhandene ENV/CLI-Werte (`LIFELINE_KARTE_STYLES`,
  `LIFELINE_PMTILES_PATH`, Default-Shortlist) dienen als **Seed/Fallback** beim ersten Start.

## Abschnitt A — Online-Quellen-Verwaltung (→ LFH-32, erweitert)

- DB-gestützte Liste von Online-Views (`name` / `url` / `typ` vektor|raster / `attribution`),
  in der Admin-UI anlegen/bearbeiten/sortieren/löschen.
- **Kuratierter Vorschlagskatalog**: die bisherige eingebaute Shortlist (OpenFreeMap
  Liberty/Dark, basemap.de Farbe/Grau, TopPlusOpen) als „aus Katalog hinzufügen".
- **Eigene URLs** hinzufügen, mit Pflicht-Attribution.
- Key-basierte Anbieter (MapTiler/Stadia) **nicht** mit Secret im Frontend — verweist auf den
  Server-Proxy (LFH-33).

## Abschnitt B — Offline-Karten-Manager (→ neuer Task, erbt LFH-31-Offline-Inhalte)

- **Registry der Offline-Karten** (PMTiles), je Eintrag: Name, Quell-URL, Lizenz, Schema
  (z. B. Protomaps), Größe, Download-Datum, Status.
- **In-App-Download:** Quelle aus Katalog wählen oder URL angeben → **Hintergrund-Download** in
  das Daten-Verzeichnis (Fortschritt, Abbruch, Plattenplatz-Check, optional Prüfsumme).
- **Ausliefern:** aus dem verwalteten Verzeichnis (Generalisierung des heutigen Single-File-Serve;
  v1 mind. eine aktive Karte).
- **Aktualisieren:** Neu-Download / Ersetzen.
- **Schema ↔ Style:** Der Offline-Style nimmt heute fix das **Protomaps-Schema** an
  (`basemapStil.ts`, Source-Layer earth/landuse/water/roads/buildings, bewusst ohne Beschriftung
  → keine Glyphs). v1: auf **PMTiles + Protomaps-Schema** standardisieren; abweichende Schemata
  (MBTiles, basemap.de-Schema) brauchen einen angepassten Style → später.
- **Vorschlagskatalog downloadbarer Quellen** + Lizenz-Guardrails (siehe unten).
- **Pflicht-Attribution auch offline sichtbar.**
- Fallback-Kette online → offline → blind verifizieren.

## Lizenz-Guardrails (für A und B)

- **Erlaubt zu spiegeln/offline:** Protomaps (CC0), OpenFreeMap (OSM/ODbL), basemap.de
  (CC BY 4.0), TopPlusOpen (BKG), OSM.
- **NICHT spiegeln (ToS verbietet):** Esri / Carto / Stadia / MapTiler-Cloud-Tiles.
- **Pflicht-Attribution immer sichtbar**, online wie offline.

## Sequenzierung

1. **Grundstein** (ENV→DB + Daten-Verzeichnis + Routen lesen DB, rückwärtskompatibel) — trägt A und B.
2. **Abschnitt A** (Online-Katalog + CRUD) — kleinerer, schneller Nutzen.
3. **Abschnitt B** (Offline-Download-Manager) — größter Brocken.
4. *(optional)* **Server-Proxy** (LFH-33).

## ClickUp-Task-Schnitt (umgesetzt)

Eigener Epic **LFH-178 „Karten-Verwaltung im Admin-UI"** (getrennt von LFH-56, das nur noch
Marker/Clustering/Tracking/Basemap-Anzeige bündelt). Subtasks in Reihenfolge:

| Task | Inhalt |
|---|---|
| **LFH-179** Grundstein | Kartenkonfig DB-gestützt + Daten-Verzeichnis + Routen lesen DB (rückwärtskompatibel) |
| **LFH-180** Online-Quellen | Online-Quellen-Verwaltung + kuratierter Vorschlagskatalog im Admin-UI |
| **LFH-181** Offline-Karten-Manager | In-App-Download/Update/Verwaltung von PMTiles; erbt die Offline-Härtung des alten LFH-31 |
| **LFH-182** Server-Proxy | Server-side Style/Tile-Proxy — optional/später |

Scoping-Task war **LFH-31** (umgewidmet, abgeschlossen). LFH-180/181/182 hängen via `waiting_on`
am Grundstein (LFH-179).

## Offene Punkte / zu verifizieren (Build-Zeit-Recherche, gehört in die Umsetzungstasks)

- Genaue **Download-Quellen + Formate** je Katalog-Eintrag: Protomaps-Build (async vs. statische
  `.pmtiles`), OpenFreeMap (Planet-only? regionaler DACH-Extract? Größe), VersaTiles-Container,
  basemap.de (downloadbare Vektor-Tiles vs. nur Tile-API), TopPlusOpen (MBTiles-Download).
- **MBTiles- vs. PMTiles-Serving** (v1 nur PMTiles?).
- **Mehrere** Offline-Karten gleichzeitig vs. genau eine aktive.
- **Plattenplatz-/Quota-Policy** und Verhalten bei Abbruch/Teil-Download.

## Referenzen

- `src/config.rs` (`KarteConfig`, `OnlineStyle`, `default_online_styles`, `online_styles_aufloesen`)
- `src/routes/karte.rs` (`config`, `tiles_fehlt`), `src/app.rs` (Karte-Routen, `route_service` PMTiles)
- `frontend/src/pages/lagekarte/basemapStil.ts` (`offlineStyle`, Protomaps-Schema-Annahme, Fallback-Kette)
- `docs/betrieb/packaging.md` (Abschnitt „Lagekarte / Basemap")
- `docs/superpowers/specs/2026-06-25-basemap-persistenz-entscheidung.md` (LFH-34, localStorage bleibt)

## Nachtrag 2026-06-26 (Nutzer-Entscheidung bei der Umsetzung)

Abweichend vom oben skizzierten Design wurde bei der Umsetzung von LFH-179 entschieden:

- **ENV-Kartenkonfig + Rückwärtskompatibilität + Seeding entfallen vollständig.** Es gibt keine
  `--pmtiles-path` / `--karte-styles` / `--karte-online-style-url`-Optionen mehr und keinen
  automatischen DB-Seed aus `default_online_styles`. Die frühere `KarteConfig` und
  `online_styles_aufloesen` wurden entfernt.
- **Die Registry startet leer.** Die Karte läuft **blind**, bis ein Admin im Admin-UI Quellen aus
  dem kuratierten Katalog (`default_online_styles`, weiterhin als Vorschlagskatalog erhalten)
  hinzufügt oder eigene Quellen anlegt. Konsequenz bewusst akzeptiert (Prep-Phase, trivial
  reversibel).
- **`karten_dir`** (Datenverzeichnis für Offline-Karten) wird aus `db_path` abgeleitet
  (`<dir>/karten`) und ist ein `AppState`-Feld — **keine eigene ENV/CLI-Option**.
