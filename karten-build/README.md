# karten-build — Offline-Basemap-Bau (bau-zeitig)

Erzeugt das **Shortbread-MBTiles** der Offline-Lagekarte. Läuft NUR beim Bau, nie in der App.
Nutzt das fertige Upstream-Image **`versatiles/versatiles-planetiler`** (Planetiler + Shortbread-
Profil) direkt — kein Custom-Dockerfile. Voraussetzung: Docker.

## Bauen
    make tiles AREA=germany                    # ganz DE
    make tiles AREA=europe/germany/bremen      # kleine Region (Test)
    make validate AREA=…                        # tiles-Anzahl + metadata (inkl. vector_layers) prüfen

`AREA` ist Geofabrik-Notation. Output landet in `out/` als `osm-*.mbtiles` (gzip, für uns) und
`osm-*.versatiles` (Brotli, ungenutzt). Zoom = Shortbread-Default (z0–14). `out/` ist gitignored.

## Publizieren
Die erzeugte `out/osm-*.mbtiles` an eine stabile HTTPS-URL / als GitHub-Release laden, dann in
`src/config.rs::default_offline_katalog()` den Platzhalter-Eintrag ersetzen:
`url` (die Host-URL), `groesse` (Bytes), `sha256` (`sha256sum out/osm-*.mbtiles`). `kachel_schema`
bleibt `"shortbread"`.

## Reproduzierbarkeit
Image-Digest (`docker inspect versatiles/versatiles-planetiler:latest`) + Geofabrik-Extract-Datum
im Release-Text festhalten. Update = erneut `make tiles`, neues Release, Katalog-URL/-SHA anheben.

## Assets (Glyphs/Sprite) — noch zu finalisieren (LFH-197)
Der Offline-Style braucht lokal gebündelte **Glyphs (OFL)** + **Sprite (CC0)** unter
`../assets/karten/{fonts,sprites}` (aktuell **Placeholder**). Quelle: VersaTiles-Fonts- und
`versatiles-style`-Sprite-Release-Artefakte (Shortbread-passend). `gen-assets.sh` ist ein
**Entwurf** — die exakten Bezugs-URLs/Tools sind auf dem Build-Host zu verifizieren (die dortigen
`docker run`-Referenzen sind noch ungeprüft).
