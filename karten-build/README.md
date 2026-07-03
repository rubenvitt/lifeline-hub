# karten-build — Offline-Basemap-Bau (bau-zeitig)

Erzeugt das **Shortbread-MBTiles** der Offline-Lagekarte. Läuft NUR beim Bau, nie in der App.
Nutzt das fertige Upstream-Image **`versatiles/versatiles-planetiler`** (Planetiler + Shortbread-
Profil) direkt — kein Custom-Dockerfile. Voraussetzung: Docker.

## Bauen
    make tiles AREA=germany        # ganz DE
    make tiles AREA=bremen         # kleine Region (Test)
    make validate                  # tiles-Anzahl + metadata (inkl. vector_layers) prüfen

`AREA` ist ein Geofabrik-Gebietsname (gegen den Geofabrik-Index gematcht — z. B. `germany`,
`bremen`, `berlin`), NICHT die Pfadnotation `europe/germany/bremen`. Die fertige Datei landet in
**`out/result/osm*.mbtiles`** (gzip, für uns) + `.sha256` (via `--checksum`); daneben `.versatiles`
(Brotli, ungenutzt). Der Rest von `out/` (Quelldaten wie das Wasser-Polygon-ZIP ~880 MB, `tmp/`,
`sources/`) ist Arbeitsdaten und kann nach dem Bau gelöscht werden. Zoom = Shortbread-Default
(z2–14, `name=Shortbread`). `out/` ist gitignored.

Die zugrundeliegende CLI ist `generate_tiles --area <name> --format mbtiles --checksum` (Default-
Format wäre `versatiles`, deshalb `--format mbtiles` explizit). `docker run` ohne Args startet einen
interaktiven Wizard.

## Publizieren
Die erzeugte `out/result/osm*.mbtiles` an eine stabile HTTPS-URL / als GitHub-Release laden, dann
in `src/config.rs::default_offline_katalog()` den Platzhalter-Eintrag ersetzen: `url` (die
Host-URL), `groesse` (Bytes), `sha256` (aus `out/result/osm*.mbtiles.sha256`). `kachel_schema`
bleibt `"shortbread"`.

## Reproduzierbarkeit
Image-Digest (`docker inspect versatiles/versatiles-planetiler:latest`) + Geofabrik-Extract-Datum
im Release-Text festhalten. Update = erneut `make tiles`, neues Release, Katalog-URL/-SHA anheben.

## Assets (Glyphs/Sprite)
Der Offline-Style braucht lokal gebündelte **Glyphs (OFL)** + **Sprite (CC0)** unter
`../assets/karten/{fonts,sprites}`. `gen-assets.sh` bezieht sie aus gepinnten Release-Artefakten
(versatiles-fonts `v2.2.0` → „Noto Sans Regular", nur DE/europäisch-latein-relevante Ranges;
versatiles-style `v5.13.0` → CC0-Sprite `basics` als `basemap`, +@2x). Ausführen: `bash
gen-assets.sh`; danach die erzeugten Dateien einchecken und das Backend neu bauen (rust-embed
bettet sie zur Compile-Zeit ein). Update = Tags im Skript anheben, neu laufen lassen, Provenienz
(vom Skript ausgegeben) im Commit festhalten.
