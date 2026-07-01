# karten-build — Offline-Basemap-Bau (bau-zeitig)

Erzeugt das Shortbread-MBTiles der Offline-Lagekarte. Läuft NUR beim Bau, nie in der App.

## Bauen
    make tiles AREA=germany        # -> out/germany.shortbread.mbtiles (z0-14)
    make validate AREA=germany     # tiles-Anzahl + metadata prüfen

## Publizieren
`out/germany.shortbread.mbtiles` als GitHub-Release-Artefakt / an eine stabile HTTPS-URL laden.
Diese URL + gemessene Größe + SHA256 gehen in `default_offline_katalog()` (src/config.rs).
SHA256:  `sha256sum out/germany.shortbread.mbtiles`

## Reproduzierbarkeit
Image-Tag (planetiler-shortbread) + Geofabrik-Extract-Datum im Release-Text festhalten.
Update = erneut `make tiles`, neues Release, Katalog-URL/-SHA in src/config.rs anheben.

## Assets (Glyphs/Sprite)
`gen-assets.sh` erzeugt die eingebetteten Offline-Assets (Glyphs/Sprite) nach `../assets/karten`
(siehe dort). Einmaliger, schema-fixer Lauf — nicht Teil des Tile-Builds.
