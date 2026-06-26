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

## LFH-181 — Umsetzungs-Design (abgenommen 2026-06-26)

Ergebnis von zwei Scope/Research-Workflows + Advisor-Review. Die „Offene Punkte" oben sind
hiermit aufgelöst. **LFH-182 (Server-Proxy) wurde zurückgestellt** (kein konkreter Nutzen ohne
key-basierte Quellen; Begründung am Task). v1-Scope = **nur LFH-181**.

### Quelle / kuratierter Katalog
- **Knackpunkt:** Es gibt keine fertige öffentliche DACH-`.pmtiles` im Protomaps-Schema. Aber
  **Project N.O.M.A.D.** (`github.com/whitespring/project-nomad-maps-europe`, Release `v1`,
  Stand 2026-03-20) hostet **direkt downloadbare Protomaps-v4-`.pmtiles` pro Bundesland**
  (Bremen ~42 MB … Bayern ~1,7 GB, DE gesamt ~9,3 GB) + Österreich (~1,9 GB) + Schweiz (~932 MB).
- **Empirisch verifiziert:** Diese Files rendern mit dem **bestehenden glyph-freien
  `offlineStyle()` ohne jede Style-Arbeit** — `de_bremen`-Tile inspiziert, `vector_layers`
  enthalten earth/landuse/water/roads/buildings. PMTiles v3, z0–15, HTTP-Range (206) bestätigt.
- **Entscheidung (User):** v1-Katalog zeigt auf die N.O.M.A.D.-URLs (DE-Bundesländer + AT + CH),
  Provenienz-Hinweis im UI. **Folge-Task** für eigenen Mirror/Self-Extract (Supply-Chain: Single-
  Maintainer-Repo). Self-Build-Pfad (dokumentiert, nicht v1): `pmtiles extract
  https://build.protomaps.com/<daily>.pmtiles de.pmtiles --region=de.geojson --maxzoom=14`.
- **VersaTiles/Shortbread zurückgestellt:** nur Planet (62 GB) → Self-Build nötig **und** bräuchte
  einen neuen Shortbread-Style (unser Protomaps-Style rendert Shortbread nicht). Dokumentierte
  Option, nicht v1.
- Katalog als `default_offline_katalog()` in `src/config.rs` (analog `default_online_styles`),
  je Eintrag name/url/region/groesse/lizenz/attribution/kachel_schema. **Kein sha256 vorab-pinnen**
  (wird beim Download berechnet).

### Backend (Download-Manager, alles hinter `AdminUser`)
- **Netz-Seam (TDD-tragend):** `validiere_download_url()` (reine Funktion, gegen böse URLs
  unit-getestet) **getrennt** von der Download-Core (`lade_offline_karte`), die gegen einen
  lokalen Loopback-Fixture-Server integrationsgetestet wird. Guard blockt Loopback, Core nicht.
- **SSRF-Guard:** https-only; Loopback/Link-local/Private-Ranges (127/8, ::1, 169.254/16, 10/8,
  172.16/12, 192.168/16, fc00::/7) ablehnen; **bei JEDEM Redirect-Hop neu validieren** (custom
  reqwest-Redirect-Policy) — N.O.M.A.D. redirectet `github.com`→`release-assets.githubusercontent.com`,
  Redirect ist der klassische SSRF-Bypass.
- **FSM:** `registriert→laedt→bereit/fehler`. `registriere_offline_karte` (Status `bereit`) NICHT
  überladen — neue Repo-Fns `setze_status`/`markiere_bereit(pfad,groesse,sha256,download_at)`/`markiere_fehler`.
- **Download-Core:** dedizierter `reqwest::Client` (connect_timeout, **kein** Globaltimeout),
  chunked via `Response::chunk()` (kein neues Cargo-Feature), Redirect-folgend; streamt nach
  `karten_dir/karte-{id}.pmtiles.part`, **inkrementelles sha256** (`Sha256::update`), bei Erfolg
  atomarer Rename → `.pmtiles`, dann `markiere_bereit`. **Kein Range-Resume in v1** (einmaliger
  Prep-Download; bei Fehler `.part` löschen + Status `fehler`, Admin re-triggert).
- **Aktive Karte:** **Re-Download der aktiven Basemap verboten** (`Conflict`) — sonst geht die
  Live-Lagekarte während des Mehr-GB-Downloads blind (`tiles()`/`pmtiles_verfuegbar` gaten auf
  `status='bereit' AND aktiv_basemap=1`). Hot-Swap an gleicher Zeile = v1.x.
- **Fortschritt:** transientes `AppState`-Feld `Arc<RwLock<HashMap<i64, Fortschritt{geladen,gesamt,abbruch}>>>`
  nach `fachebenen.inflight`-Muster — **keine DB-Spalte**. Einträge in **allen** Pfaden
  (Erfolg/Fehler/Abbruch) wieder **entfernen**.
- **Abbruch:** `AtomicBool` im Fortschritt-Eintrag, je Chunk geprüft (kein neuer Dep).
- **Concurrency-Guard:** POST `Conflict`, wenn Zielzeile bereits `laedt` (spiegelt inflight-Dedup).
- **Plattenplatz-Check vor Download:** Crate **`fs4`** (maintained Fork von fs2). Gegen
  `Content-Length` prüfen; fehlt sie hinter dem Redirect → Fallback auf die **bekannte
  Katalog-Größe**.
- **Crash-Recovery beim Start** (in `main.rs` bei den Schedulern): hängende `status='laedt'` →
  `fehler` + verwaiste `*.part` in `karten_dir` löschen (spawned Tasks überleben keinen Neustart).
- **Endpunkte:** `POST /api/karte/offline-karten/download` (Body: url+name+lizenz+kachel_schema,
  ODER `katalog_id`), `POST /{id}/abbrechen`, `GET /api/karte/offline-karten/katalog`.

### Frontend (spiegelt LFH-180 1:1)
- Neuer Seam `frontend/src/api/offlineKarten.ts` + Komponente `OfflineKartenVerwaltung.tsx` als
  **zweiter Abschnitt** auf `/admin/karten` (Slot reserviert), antd `<Table>` + farbige `<Tag>`-Status
  + admin-only Aktionsspalte (`<Popconfirm>`). Download/Registrieren via Form-in-Modal
  (Vorlage `OnlineQuelleFormModal`), Katalog via Modal+List (Vorlage `AusKatalogModal`).
- **Fortschritt = Status-Polling:** Liste pollt (`refetchInterval`) solange eine Zeile `laedt`;
  optional grobe Bytes-% aus dem In-Memory-State im JSON. Kein SSE (LiveHub ist einsatz-scoped).
  Indeterminierter `<Progress>`/`<Spin>` reicht für v1.
- Nach Download-Abschluss/Aktivieren **`invalidiereKarte(qc)`** rufen (invalidiert auch
  `['karte-config']` → Lagekarte sieht `pmtiles_verfuegbar`-Umsprung ohne Reload).

### Consumer-Seite (Lagekarte)
- **Cache-Busting** der `pmtiles_url`: `config()` hängt `?v=<token>` an (verhindert korrupte Tiles
  bei Karten-**Wechsel**, weil die pmtiles-Lib auf die URL cached). Token = **`sha256 ?? geaendert_at`**
  (registrierte Dateien ohne Download haben kein sha256). `ServeFile` ignoriert Query-Params.
- **Offline-Attribution** (echte Lücke): `aktuelleAttribution()` liefert offline heute `null`.
  Die `lizenz` der aktiven Offline-Karte in `KarteConfigAntwort` ausspielen + offline-Zweig in
  `aktuelleAttribution()` → ODbL „© OpenStreetMap contributors" wird offline sichtbar. **`lizenz`
  für Katalog-/Download-Einträge zur Pflicht** machen (Parität zur Online-Attribution-Pflicht).
- `offlineStyle()` bleibt v1 unverändert glyph-frei. Labels offline = v1.x (Latein-SDF-Glyphs
  ~<2 MB + Sprite via rust-embed + zweiter beschrifteter Style).

### Verifikation (verification-before-completion)
Echter Beweis: kleinste Datei (Bremen ~42 MB) durch den Manager laden + auf der Lagekarte
rendern — schließt empirisch die „rendert mit bestehendem Style"-Schleife.
