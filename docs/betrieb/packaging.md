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
| `--pmtiles-path` | `LIFELINE_PMTILES_PATH` | *(leer)* | Lokale PMTiles-Basemap (Offline-Karte), per HTTP-Range ausgeliefert |
| `--karte-styles` | `LIFELINE_KARTE_STYLES` | *(Default-Shortlist)* | JSON-Liste benannter Online-Views: `[{"name","url","typ":"vektor\|raster","attribution"}]`. Hat Vorrang vor `--karte-online-style-url` |
| `--karte-online-style-url` | `LIFELINE_KARTE_STYLE_URL` | *(leer)* | Online-MapLibre-Style-JSON-URL (Einzel-URL-Kurzform; ergibt einen Ein-Element-View „Online") |

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

Die Lagekarte (Modul „Lagekarte") rendert mit MapLibre GL und ist offline-fähig. Zwei
Konfigurationsquellen, beide optional:

- **`--pmtiles-path` / `LIFELINE_PMTILES_PATH`** — Pfad zu einer lokalen **PMTiles**-Datei
  (z. B. ein Protomaps-Build von [build.protomaps.com](https://build.protomaps.com),
  DE-weit mehrere GB). Der Server liefert sie per **HTTP-Range** unter
  `/api/karte/tiles.pmtiles` aus. Ideal für den ELW ohne Netz.
- **`--karte-styles` / `LIFELINE_KARTE_STYLES`** — mehrere Online-Views als JSON-Liste.
  Jeder View: `name` (Anzeigename im Switcher), `url` (Vektor-Style-JSON-URL **oder**
  Raster-Tile-Template mit `{z}/{y}/{x}`), `typ` (`vektor` Default | `raster`),
  `attribution` (Pflicht-Attribution, wird je View angezeigt). Fehlt diese ENV **und**
  `LIFELINE_KARTE_STYLE_URL`, liefert der Server eine eingebaute schlüsselfreie Shortlist
  (OpenFreeMap, basemap.de, TopPlusOpen). Key-basierte Anbieter (MapTiler/Stadia) **nicht**
  mit Secret hier hinterlegen — nur serverseitig/Domain-Restriction.
- **`--karte-online-style-url` / `LIFELINE_KARTE_STYLE_URL`** — Einzel-URL-Kurzform für eine
  vollständige MapLibre-**Style-JSON-URL** (online). Ergibt einen Ein-Element-View „Online";
  wird ignoriert, sobald `LIFELINE_KARTE_STYLES` gesetzt ist.

**Laufzeit-Bevorzugung im Frontend:** online (falls erreichbar) → Offline-PMTiles →
**Blind-Modus** (neutrales Raster). Im Blind-Modus funktionieren Marker und das Verorten
weiterhin — nur der Kartenhintergrund fehlt. Ein Umschalter in der Sidebar erlaubt
die manuelle Wahl; im Modus **Online** erscheint zusätzlich ein **Sub-Switcher**, mit dem
zwischen den konfigurierten Online-Views umgeschaltet wird (Stil + Pflicht-Attribution
wechseln dynamisch). Fehlt der PMTiles-Pfad, liefert `/api/karte/tiles.pmtiles` 404 und das
Frontend nutzt automatisch Online bzw. Blind.

**Schema-Hinweis (Offline-Vektor-Style):** Der gebündelte Offline-Style nimmt das
**Protomaps-Schema** an (Source-Layer `earth`/`landuse`/`water`/`roads`/`buildings`) und
rendert bewusst **ohne Beschriftung** — so werden keine Glyphs/Offline-Fonts benötigt.
PMTiles-Dateien mit einem anderen Schema brauchen einen angepassten Offline-Style
(`frontend/src/pages/lagekarte/basemapStil.ts`) oder die Online-Style-URL.
