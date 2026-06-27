# Offline-Karten: Eigen-Extract aus Protomaps (LFH-183) — Runbook

**Folge-Task aus LFH-181 / LFH-183.** Löst den Offline-Karten-Katalog vom fremden
Community-Repo **Project N.O.M.A.D.** (`github.com/whitespring/project-nomad-maps-europe`) und
ersetzt ihn durch **selbst gebaute, projektkontrollierte PMTiles** aus dem offiziellen
Protomaps-Daily-Build. Motiv: Supply-Chain-/Verfügbarkeits-Härtung für ein Behörden-/ELW-Tool —
ein Single-Maintainer-Repo darf nicht der einzige Beschaffungsweg zur Prep-Zeit sein.

Der Download selbst ist einmalig in der Prep-Phase (mit Netz); einmal geladene Karten sind auf
dem Gerät sicher. Dieses Runbook beschreibt den **wiederholbaren Bau- und Hosting-Prozess**.

## Was im Code bereits steckt (LFH-183, gemerged)

- **SHA256-Pin** je Katalog-Eintrag (`OfflineKatalogEintrag.sha256`, `src/config.rs`) wird beim
  Download gegen den berechneten Hash **verifiziert** (`lade_datei` → `DownloadFehler::HashMismatch`).
  Greift in **beiden** Download-Pfaden (Erst-Download aus dem Katalog **und** Update/Re-Download).
- **One-Click-Update:** „Aktualisieren" lädt den neuen Stand und das Backend aktiviert ihn nach
  Erfolg automatisch und löscht die alte Karte (`ersetzt_karte_id` → `ersetze_aktive_offline_karte`).
  Eine inaktive Hintergrundkarte zu aktualisieren lässt die aktive Basemap unberührt.
- Der Katalog (`default_offline_katalog`) zeigt **noch auf N.O.M.A.D.** (sha256 = `None`) — der
  Umstieg auf den Eigen-Mirror ist der letzte Schritt (siehe „Katalog umstellen").

## Voraussetzungen

- **`pmtiles` CLI** (go-pmtiles): `brew install protomaps/tap/pmtiles` oder
  `go install github.com/protomaps/go-pmtiles@latest`.
- **Region-GeoJSONs** je Zielregion als `<slug>.geojson`:
  - 16 DE-Bundesländer: OSM `admin_level=4` (z. B. via Overpass `relation["admin_level"="4"]
    ["boundary"="administrative"](area:DE)` → GeoJSON, oder geoBoundaries ADM1 DE).
  - AT und CH: Landesgrenze (`admin_level=2`).
  - Slug = Datei-Basename → wird zum PMTiles-Dateinamen; sprechend wählen
    (`de_bremen`, `de_bayern`, …, `austria`, `switzerland`).

## Schema-Gate (PFLICHT vor dem Massen-Build)

Der Daily-Build ist die **„Version 4 Protomaps basemap"** (Doku:
`docs.protomaps.com/basemaps/downloads`), kompatibel mit `@protomaps/basemaps` Style v4.0.0+ —
**dasselbe Schema, das unser `offlineStyle()` rendert** (kein Shortbread, anders als VersaTiles).
Trotzdem vor dem teuren Vollbau EINMAL empirisch bestätigen:

1. Eine kleine Region extrahieren (z. B. Bremen).
2. `pmtiles show <datei>.pmtiles` → `vector_layers` müssen `earth`, `water`, `roads`, `buildings`,
   `landuse` enthalten.
3. Die Datei lokal als Offline-Karte laden (Admin-Panel → „Per URL"/lokal) und in der Lagekarte
   **rendern** lassen (Browser-Smoke, WebGL). Erst wenn das stimmt: alle Regionen bauen.

## Bauen

Der Build-Channel liegt unter `https://maps.protomaps.com/builds`; die genaue Datei ist
datums-volatil (~7 Tage Retention) → **zeitnah bauen** und die EXAKTE URL zur Build-Zeit aus
`docs.protomaps.com/basemaps/downloads` ziehen.

```bash
scripts/build-offline-karten.sh \
  https://maps.protomaps.com/builds/<YYYYMMDD>.pmtiles \
  ./geojson \
  ./out
# MAXZOOM=14 scripts/build-offline-karten.sh ...   # kleinere Dateien (Default 15 = Parität N.O.M.A.D.)
```

Ergebnis: `./out/<slug>.pmtiles` je Region + `./out/catalog-snippet.txt` mit `groesse`/`sha256`.
ODbL: Produced Work, **Attribution Pflicht** (im Katalog-Eintrag `lizenz` gesetzt, offline sichtbar).

### Größen-/Hosting-Hinweis (maxzoom)

z15 = schärfer, aber größer. Einzelne Länder liegen nahe der **GitHub-Release-2-GB/Datei-Grenze**
(AT ≈ 1,9 GB). Bei GitHub-Release-Hosting ggf. `MAXZOOM=14` bauen; bei Object-Storage (S3/R2) ist
die Dateigröße unkritisch.

## Hosting (projektkontrolliert)

Eine der beiden Optionen — beide erfüllen „vom Projekt kontrollierte, stabile URL":

- **Eigener S3/R2-Bucket (Sidecar):** keine 2-GB-Grenze; HTTPS-URL je Datei, öffentlich lesbar.
- **GitHub-Release des Projekts:** kostenlos, je Datei ≤ 2 GB (→ ggf. `MAXZOOM=14`).

Die Dateien müssen per **HTTPS** und **HTTP-Range (206)** erreichbar sein (PMTiles-Voraussetzung)
und den SSRF-Guard passieren (nur https, keine internen Ziele — `validiere_download_url`).

## Katalog umstellen (letzter Schritt — LFH-183 Task 5)

In `src/config.rs` → `default_offline_katalog()`:

1. `BASIS` auf die eigene Storage-URL setzen (S3/Release-Basis).
2. Dateinamen/Slugs an die selbst gebauten Dateien anpassen.
3. Je Eintrag `sha256: Some("…")` aus `catalog-snippet.txt` eintragen.
4. `QUELLE`/Doc-Kommentare auf den Eigen-Mirror umschreiben; N.O.M.A.D.-Bezug entfernen.
5. Den Hinweistext im `OfflineDownloadKatalogModal` („Quelle: Community-Repo (Project N.O.M.A.D.)")
   auf die eigene Quelle anpassen.
6. Test `offline_katalog_*` aktualisieren: kein `whitespring`-Hotlink mehr, `sha256` gepinnt.

Danach verifizieren **beide** Download-Pfade automatisch gegen den Pin; ein manipuliertes/falsches
Asset führt zu `HashMismatch` → Status `fehler` (kein stilles Ausliefern).

## Aktualisierungs-Frequenz / Datenstand

ODbL-Daten ändern sich laufend. Empfehlung: **quartalsweise** oder anlassbezogen neu bauen. Den
Datenstand (Build-Datum) im Katalog-Namen/Doku führen; die UI zeigt „Update verfügbar", sobald der
eingebaute Katalog eine neuere URL führt als die installierte Karte (Datums-Vergleich in der URL).

## Bekannte, bewusst offene Punkte (eigene Folge-Tasks)

- **Double-Submit beim Update:** die alte `bereit`-Zeile behält ihren „Aktualisieren"-Button
  während des laufenden Update-Downloads; ein zweiter Klick spawnt einen zweiten Ersatz. Fix wäre
  ein `laedt`-Guard am Button.
- **Koexistenz Online+Offline (Overlay):** aktuell ist die Basemap umschaltbar (eine aktiv), nicht
  additiv überlagert — bewusst nicht Teil von LFH-183.
- **HashMismatch-Pfad nicht HTTP-integration-getestet:** Der Pin-Vergleich ist in `lade_datei`
  unit-getestet; bei Mismatch greift im Download-Handler der bestehende (vor LFH-183 vorhandene)
  Fehler-Arm (`.part` entfernen + Status `fehler`). Ein End-to-End-Test über `POST /download` ist
  durch den SSRF-Guard (blockt Loopback-Fixtures) nicht trivial — die neue Branch-Auswahl der
  Erfolgs-Finalisierung ist stattdessen direkt unit-getestet (`finalisierung_tests`).
