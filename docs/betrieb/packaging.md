# Betrieb: Bauen & Betreiben der Binary

lifeline-hub wird als **eine** ausführbare Datei ausgeliefert. Sie enthält API,
eingebettetes Frontend und (statisch gebündeltes) SQLite — kein separater
Webserver, keine Laufzeit-Abhängigkeiten.

## Bauen

Voraussetzungen: Rust-Toolchain (stable) und Node.js (für den Frontend-Build).

```bash
./scripts/build-release.sh
```

Das Skript baut zuerst das Frontend nach `frontend/dist` und danach die
Release-Binary, die `frontend/dist` zur Compile-Zeit einbettet. Ergebnis:
`target/release/lifeline-hub`.

> **Wichtig:** Das Frontend muss **vor** dem Release-Build gebaut sein, sonst
> bettet die Binary einen veralteten/leeren Frontend-Stand ein. Das Skript
> erledigt die Reihenfolge automatisch.

## Starten

```bash
./target/release/lifeline-hub --db-path /var/lib/lifeline/lifeline.db --bind 0.0.0.0:8080
```

Konfiguration per CLI-Flag oder ENV (Auszug):

| Flag | ENV | Default | Bedeutung |
|---|---|---|---|
| `--db-path` | `LIFELINE_DB_PATH` | `lifeline.db` | Pfad zur SQLite-Datei |
| `--bind` | `LIFELINE_BIND` | `127.0.0.1:8080` | Lausch-Adresse |
| `--org-name` | `LIFELINE_ORG_NAME` | `Meine Organisation` | Org-Name beim ersten Start |
| `--admin-user` | `LIFELINE_ADMIN_USER` | `admin` | Initialer Admin (erster Start) |
| `--admin-password` | `LIFELINE_ADMIN_PASSWORD` | *(generiert)* | Fehlt es, wird beim ersten Start ein Zufallspasswort ins Log geschrieben |

> **Erstes Admin-Passwort:** Wurde kein `--admin-password` gesetzt, schreibt die
> Binary beim ersten Start ein Zufallspasswort als Warnung ins Log. Mit systemd:
> `journalctl -u lifeline-hub | grep -i passwort`. Beim direkten Start:
> in der Konsolenausgabe nach „Initiales Admin-Passwort" suchen. Danach umgehend
> über die Weboberfläche ändern.

Beim ersten Start legt die Binary die DB-Datei an, spielt die Migrationen ein
und bootstrappt das Admin-Konto.

## Lokaler Betrieb (ELW / Mini-PC)

`--bind 0.0.0.0:8080` macht den Server im lokalen WLAN erreichbar. Clients geben
die Server-URL einmalig in der PWA ein. TLS ist empfohlen, im vertrauenswürdigen
LAN ist HTTP zulässig.

> **Hinweis:** Die Binary wird auf einem Entwickler-/Build-Rechner mit Node.js und
> Rust gebaut und dann als fertige Datei auf den ELW-Rechner kopiert. Auf dem
> ELW-Rechner selbst werden weder Node.js noch eine Internetverbindung benötigt.

## Lagekarte / Basemap

Die Lagekarte (Modul „Lagekarte") rendert mit MapLibre GL und ist offline-fähig. Die
Kartenkonfiguration ist **DB-gestützt und zur Laufzeit über das Admin-UI verwaltbar**
(`/admin/karten`) — **keine ENV/CLI-Optionen mehr** (LFH-179). Die Registry **startet leer**;
die Karte läuft im **Blind-Modus**, bis ein Admin Quellen hinzufügt:

- **Online-Quellen** (Vektor-Style-JSON oder Raster-Tile-Template mit `{z}/{y}/{x}`): pro Quelle
  `name`, `url`, `typ` (`vektor`|`raster`) und eine **Pflicht-Attribution** (je View angezeigt).
  Ein kuratierter, schlüsselfreier **Vorschlagskatalog** (OpenFreeMap, basemap.de, TopPlusOpen)
  steht zum Hinzufügen bereit.
- **Server-Proxy + Tile-Cache** (LFH-182/190): Online-Quellen werden **standardmäßig** „über
  Server geproxt" (pro Quelle abschaltbar). `/api/karte/config` gibt dann nur relative
  `/api/karte/proxy/{id}/…`-URLs aus; der Server holt Style/Tiles/Sprite/Glyphs und reicht sie
  durch — **ein Key in der Upstream-URL bleibt server-seitig und erscheint nie im Browser** (für
  Nicht-Admins ist die URL in der Verwaltungsliste maskiert). Jeder Upstream-Abruf ist SSRF-geschützt
  (https-only, interne Ziele + DNS-Rebinding/IPv6-eingebettetes IPv4 blockiert, pinnender Resolver).
  - **Tile-Cache:** Binär-Assets (Tiles/Sprite/Glyphs) werden serverseitig zwischengespeichert
    (separate `tile-cache.db` im `karten_dir`, damit Tile-Writes nicht gegen operative Writes
    konkurrieren). Respektiert die Upstream-Header (`no-store`/`private` → nie cachen, `max-age`
    → TTL, `ETag` → bedingte Revalidierung); LRU-Eviction unter **256 MB** Cap; bei Upstream-Ausfall
    wird der (Stale-)Cache weiter serviert (Resilienz). Damit trifft eine im Einsatz geteilte
    Kachel den Anbieter **nur einmal**. Style/TileJSON werden nicht gecacht (selten, key-frei
    umgeschrieben).
  - **ToS-Pflicht:** Proxy/Cache **nur** aktivieren, wenn der Anbieter Proxying/Caching erlaubt.
    OpenFreeMap und basemap.de/BKG (eingebauter Katalog) sind erlaubt; **OSM-Standard-Tiles**
    (`tile.openstreetmap.org`) **verbieten** es → dort Proxy pro Quelle abschalten.
  - **v1-Grenzen:** unterstützte Platzhalter `{z}/{x}/{y}/{-y}`, `{fontstack}/{range}` (andere
    werden beim Speichern abgelehnt); kein Single-Flight (parallele Erst-Misses derselben Kachel
    erzeugen je einen Upstream-Fetch, konvergieren danach).
- **Offline-Karte (Shortbread/MBTiles)** (LFH-195): eine **lokale MBTiles-Datei** (= SQLite)
  im **Shortbread-Schema** wird als Offline-Karte registriert/aktiviert; der Server liest die
  Kacheln selbst aus der SQLite-DB und liefert sie unter `/api/karte/offline/tiles/{z}/{x}/{y}`
  aus (XYZ, TMS-Y-Flip, `Content-Encoding: gzip`). **Glyphs (OFL) und Sprite (CC0)** sind ins
  Binary eingebettet und werden lokal unter `/api/karte/offline/{fonts,sprites}/…` serviert →
  **Beschriftung offline verfügbar**, kein Fremd-Abruf. Ideal für den ELW ohne Netz. Das
  Datenverzeichnis leitet sich aus dem DB-Pfad ab (`<Verzeichnis von --db-path>/karten`) und
  wird beim Start angelegt.
  - **Erzeugen des MBTiles** (bau-zeitig, nicht in der App): das Repo-Projekt `karten-build/`
    (Docker + **Planetiler-Shortbread**) baut ein Regions-Bundle, Default **Deutschland z0–14**
    (`make -C karten-build tiles AREA=germany`, ~einige GB). Das fertige `germany.shortbread.mbtiles`
    wird als GitHub-Release / an einer stabilen URL gehostet; URL + gemessene Größe + SHA256 gehen
    in `default_offline_katalog()` (`src/config.rs`). **Kein Laufzeit-Docker / kein externer
    Tile-Service** — die App serviert die MBTiles selbst (LFH-178-Eckpunkt „alles in-App").
  - **Laden/Aktualisieren über die Admin-UI:** der Offline-Karten-Manager lädt das Bundle per
    verifiziertem Download (SHA256-Pin, SSRF-Guard) und aktiviert es; „Aktualisieren" = neue
    Version laden + aktivieren + alte entfernen (One-Click-Update).

**Laufzeit-Bevorzugung im Frontend:** online (falls erreichbar) → Offline (Shortbread/MBTiles) →
**Blind-Modus** (neutrales Raster). Im Blind-Modus funktionieren Marker und das Verorten
weiterhin — nur der Kartenhintergrund fehlt. Ein Umschalter in der Sidebar erlaubt
die manuelle Wahl; im Modus **Online** erscheint zusätzlich ein **Sub-Switcher**, mit dem
zwischen den konfigurierten Online-Views umgeschaltet wird (Stil + Pflicht-Attribution
wechseln dynamisch). Ohne aktive Offline-Karte liefert `/api/karte/offline/tiles/{z}/{x}/{y}`
`204 No Content` und das Frontend nutzt automatisch Online bzw. Blind.

**Schema-Hinweis (Offline-Vektor-Style):** Der Offline-Style
(`frontend/src/pages/lagekarte/basemapStil.ts`) nimmt das **Shortbread-Schema** an und rendert
**mit Beschriftung** (`name_de`-Label-Layer über die lokal eingebetteten Glyphs/Sprite). Die
exakte visuelle Stil-Feinjustage (colorful/graybeard/„amtlich"-getunt) ist eine spätere
Entscheidung an Live-Demos. Der frühere Protomaps-PMTiles-Pfad (Online-Protomaps + statischer
`/api/karte/tiles.pmtiles`-Serve) ist entfernt (LFH-196).
