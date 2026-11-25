---
id: ADR-0098
titel: Copernicus-Rasterbilder werden serverseitig gekachelt, der Browser sieht nur Kennungen
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - src/karte/cog.rs
  - src/karte/copernicus_bilder.rs
  - frontend/src/pages/lagekarte/copernicusBildLayer.ts
herleitung:
  - docs/superpowers/specs/2026-11-24-h11vkn1p-copernicus-cog-rasterbilder-design.md
  - LLH-2021 (mit Ruben am 24.11.2026 abgestimmt)
  - ADR-0079
---

# ADR-0098: Copernicus-Rasterbilder werden serverseitig gekachelt, der Browser sieht nur Kennungen

## Regeln

- MUST: Die COG-Bilder der Copernicus-Aktivierungen erreichen MapLibre nur als PNG-Kacheln über
  `GET /api/map/overlays/copernicus/images/{bild}/{z}/{x}/{y}`.
- MUST NOT: Das Frontend ruft den S3-Host der Quelle nie selbst auf, auch nicht über ein
  COG-Protokoll im Browser.
- MUST: Die Kachelroute nimmt nur die 16-stellige Kennung aus der Bilderliste an, nie einen Pfad
  oder eine URL; geladen wird nur `EBENEN_BASIS` plus ein geprüfter Pfad aus den Details.
- MUST: Gezeigt werden nur die Bilder der Produkte, die `select_produkte` für die Vektorebene wählt.
- MUST NOT: Ein Bild außerhalb von EPSG:3857 oder mit gedrehter Georeferenz wird nicht umprojiziert,
  sondern als „nicht darstellbar“ gelistet.
- MUST: Die Kachelroute verlangt `KartenZugriff` wie die Proxy-Kacheln (LFH-1072) und sendet nur
  privates `Cache-Control`.
- SHOULD: Kopf und gerenderte Kacheln liegen im Kachel-Cache (`tile_cache`), nicht im
  Fachebenen-Cache, damit sie dessen 48-h-Aufräumen überstehen.

## Prüfung

```sh
# Exit 0, solange die Regeln gelten (Hilfen und Grenzen: docs/architektur/AGENTS.md).
verbiete 'rapidmapping-viewer|geotiff' 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx'
verlange 'fn kennung_gueltig' 'src/karte/copernicus_bilder.rs'
verlange 'starts_with\(EBENEN_BASIS\)' 'src/karte/copernicus_bilder.rs'
verlange 'copernicus::select_im_ausschnitt' 'src/karte/copernicus_bilder.rs'
verlange 'nicht in Web-Mercator' 'src/karte/cog.rs'
verlange 'tile_cache::schreibe_eintrag' 'src/karte/copernicus_bilder.rs'
verlange 'COPERNICUS_KACHEL_CACHE_CONTROL: &str = "private' 'src/routes/karte.rs'
verbiete '^proj' 'Cargo.toml'
```

## Kontext

Copernicus liefert zu optischen Produkten das Orthobild als Cloud Optimized GeoTIFF auf S3. S3
schickt keinen CORS-Kopf, der Browser darf die Datei also nicht lesen, und gekoppelte Geräte
haben oft kein Internet. Vorgefertigte Kacheln der Quelle gibt es ohne Stabilitätszusage nicht.
Die gemessenen Bilder liegen schon in Web-Mercator vor, ein Range-Leser mit Übersichtswahl genügt.

## Konsequenzen

Der Server liest per HTTP-Range nur Kopf und nötige Quellkacheln und rendert 256-px-PNGs; das
kostet Rechenzeit, bündelt aber Cache, Offline-Auslieferung und SSRF-Grenze an einer Stelle. Ein
anders projiziertes oder kodiertes COG erscheint nicht, statt falsch zu liegen. In Gebieten, deren
gezeigtes Produkt kein Bild hat (Radar), gibt es kein Bild, auch wenn ein jüngeres Produkt ohne
Flächen eines hätte.
