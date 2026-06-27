# Offline-Karten: Selbst-hostbare, komplett offline-fähige Vektor-Basemaps

**Recherche- und Konzept-Report (LFH-195; Altlasten-Ausbau: LFH-196)**
Stand: 2026-06-27 · Kontext: ELW-/Behörden-Web-App, MapLibre-GL-JS-Frontend, Rust+SQLite-Backend

---

## 0. Kurzfassung (TL;DR)

**Empfehlung:** Eigene Tile-Produktion aus OpenStreetMap mit **Planetiler**, Tile-Schema
**Shortbread**, Stil **VersaTiles Colorful**, ausgeliefert als **MBTiles** (= SQLite, passt zum
Backend) und gerendert mit lokal gebündelten **Glyphs (Noto/Open-Font, OFL)** + **Sprite
(CC0)**. Zweite, gleichwertige Option ist der **Protomaps-Basemap-v4**-Stack als
**Single-File-PMTiles** mit dem CC0-Stil `@protomaps/basemaps`. Beide sind 100 % offline
bündelbar, ohne Fremd-API-Keys und ohne Fremd-Hosting selbst baubar und aktualisierbar.

**`basemap.de` (amtlich) scheidet als Offline-Basis aus** — nicht primär aus Lizenzgründen,
sondern weil es **nicht selbst baubar/aktualisierbar** ist (amtliche AdV-/Geobasisdaten, kein
offizielles Offline-/Bulk-Download-Produkt) und damit die harte Anforderung (b) verfehlt. Es
bleibt als optionaler Online-Layer interessant. **Kommerzielle/gehostete Lösungen
(MapTiler, Stadia)** scheiden an „keine fremden API-Keys/kein Fremd-Hosting" aus.

**Wichtigste Entscheidungsfaktoren (gewichtet):**
1. **Renderqualität + Beschriftung** (höchstes Gewicht; minimalistisch/label-los wurde
   abgelehnt) → Shortbread/Colorful liefert die dichteste, „full-featured" beschriftete Karte
   mit nativen `name_de`-Feldern; Protomaps-Light ist sauber, aber zurückhaltender.
2. **Selbst-Hostbarkeit / Supply-Chain-Härtung** → OSM-basierte Eigenproduktion mit
   Planetiler; Stil CC0/Unlicense, Fonts OFL → keine Fremdabhängigkeit zur Laufzeit.
3. **Offline-Vollständigkeit (Style + Glyphs + Sprite + Tiles)** → alle vier Bausteine als
   statische Dateien bündelbar; keine externen Laufzeit-Abrufe.
4. **Aufwand/Wartbarkeit** → MBTiles ist SQLite → niedrigste Supply-Chain-Fläche im
   bestehenden Rust+SQLite-Backend (kein neues Format-Dependency). Monatlicher Rebuild aus
   dem Geofabrik-Extract ist ein einzelner reproduzierbarer Befehl.

---

## 1. Anforderungen & Bewertungsdimensionen

Aus dem Auftrag abgeleitet, als Prüfraster:

| Dimension | Konkrete Frage |
|---|---|
| **Renderqualität + Labels** | Orts-/Straßennamen vorhanden? „amtlich"-anmutend, nicht minimalistisch? Deutsche Labels (`name:de`)? |
| **Build-Aufwand / Tooling / Hardware** | Womit baubar? RAM/Disk/Zeit für DE bzw. DACH? |
| **Speichergröße je Region** | Tile-Volumen DE / DACH (z0–14)? |
| **Update-Frequenz / -Pipeline** | Wie oft/aufwendig aktualisierbar, ohne Fremd-Hosting? |
| **Lizenz + Attribution** | ODbL / CC-BY / DL-DE-BY? Bleibt Attribution offline erfüllbar? |
| **Offline-Tauglichkeit Style/Glyphs/Sprite** | Lassen sich Style-JSON, Glyph-PBFs und Sprite-Sheet statisch bündeln (keine Laufzeit-CDN-Abrufe)? |

**Harte K.-o.-Kriterien** (aus Auftrag):
- (a) **Korrekt UND beschriftet** gerendert, „amtlich"-anmutend.
- (b) **Eigenständig baubar + aktualisierbar OHNE fremde API-Keys / Fremd-Hosting.**
- (c) **Style + Glyphs + Sprite müssen offline gebündelt funktionieren** (keine externen
  Laufzeit-Abrufe).

---

## 2. Konzept-Grundlagen: drei entkoppelte Achsen

Ein häufiges Missverständnis ist, „Protomaps vs. VersaTiles vs. OpenMapTiles" als *eine*
Entscheidung zu behandeln. Tatsächlich sind es **drei unabhängige Achsen**, die man frei
kombinieren kann:

1. **Tile-Schema + passender Stil + Assets** — bestimmt Datenmodell *und* Optik. Dies ist die
   eigentlich kartografische Entscheidung. Drei freie, vollständige Kombinationen:
   - **Protomaps Basemap v4** + `@protomaps/basemaps` (CC0) + `basemaps-assets` (OFL/MIT)
   - **Shortbread** + `versatiles-style` Colorful/… (CC0/Unlicense) + VersaTiles-Fonts/Sprites
   - **OpenMapTiles** + osm-bright/positron/osm-liberty + `openmaptiles/fonts` (OFL/Apache)
2. **Container/Format** — **MBTiles** (SQLite-Datei) **oder PMTiles** (eine cloud-optimierte
   Single-File). Reine Verpackungsfrage; beide sind offline-tauglich.
3. **Builder** — **Planetiler** (schnell, Default) **oder Tilemaker** (RAM-arm, Fallback).

**Schlüsselpunkt: Planetiler baut alle drei Schemata und schreibt beide Container.** Die Wahl
„Protomaps vs. Shortbread" ist also *nur* die Schema-+-Stil-Frage; Builder und Container sind
frei wählbar. Beispiel: *Shortbread, gebaut mit Planetiler, ausgeliefert als MBTiles* ist eine
völlig kohärente Kombination — und genau die hier empfohlene.
[Quelle: Planetiler README — OpenMapTiles, Protomaps Basemaps und Shortbread als mitgelieferte
Profile, Output MBTiles+PMTiles]

### Die vier Offline-Bausteine einer MapLibre-Karte

Eine MapLibre-Karte besteht aus vier referenzierten Ressourcen — **alle vier müssen lokal
liegen**, sonst gibt es Laufzeit-Abrufe:

| Baustein | Was | Offline-Form |
|---|---|---|
| **Style-JSON** | `style.json` (Version 8): `glyphs`, `sprite`, `sources`, `layers` | statische Datei, relative/lokale URLs |
| **Tiles** | Vektor-Kacheln (MVT, gzip) | `*.mbtiles` (SQLite) oder `*.pmtiles` |
| **Glyphs** | SDF-Font-Kacheln `…/{fontstack}/{range}.pbf` (je 256 Codepoints) | Ordner mit PBFs je Fontstack |
| **Sprite** | Icon-Atlas `sprite.png` + `sprite.json` (+ `@2x`) | 2–4 statische Dateien |

Die `glyphs`- und `sprite`-Properties im Style sind URL-Templates — sie zeigen im
Auslieferungszustand der Projekte auf CDNs (z. B. `protomaps.github.io`,
`tiles.versatiles.org`). Für „komplett offline" werden sie auf lokale Pfade umgebogen (z. B.
`/maps/fonts/{fontstack}/{range}.pbf`). Genau das ist der kritische Handgriff für Anforderung
(c).

---

## 3. Weg 1 — Eigene Tile-Produktion aus OSM (empfohlen)

### 3.1 Builder: Planetiler vs. Tilemaker

| | **Planetiler** | **Tilemaker** |
|---|---|---|
| Sprache/Setup | Java 21, ein JAR, keine DB | C++, eine Binary, keine DB |
| Planet-Build | **~1–1,5 h** (16–64 Cores), Referenz: **3 h 21 min** inkl. Download → **99 GB** MBTiles auf 16 CPU / 128 GB RAM | **~7–8 h, ~144 GB RAM** (laut Planetiler-Vergleich); „nicht für den ganzen Planeten gedacht" |
| RAM-Modell | ~0,5× Input-Größe min.; 1,5× für `--nodemap-type=array --storage=ram`; sonst `--storage=mmap` (Disk-Spill) | hält per Default alles im RAM; für große Gebiete `--store` auf SSD |
| Disk | ~5–10× der `.osm.pbf`-Größe temporär | moderat, SSD-Spill möglich |
| Geofabrik-Integration | `--area=germany` lädt Extract automatisch | manueller `.osm.pbf`-Download |
| Schemata | **OpenMapTiles (Default), Protomaps Basemaps, Shortbread** (mitgeliefert) | OpenMapTiles-kompatible Config mitgeliefert; **Shortbread** via `geofabrik/shortbread-tilemaker` |
| Output | **MBTiles, PMTiles** (+ MVT/MLT) | Einzeldateien, **MBTiles, PMTiles** |
| Stärke | Geschwindigkeit, Reproduzierbarkeit, Planet-tauglich | läuft auf RAM-armer Hardware, Lua-Profile leicht anpassbar |

**Fazit Builder:** **Planetiler** ist für DE/DACH die erste Wahl (schnell, deterministisch,
Geofabrik-Auto-Download, alle drei Schemata). **Tilemaker** ist der valide **Fallback für
RAM-arme Build-Umgebungen** oder wenn man ohnehin Lua-Profile pflegt. Beide schreiben dieselben
Container-Formate; die Builder-Wahl ist **nicht** an Schema oder Container gekoppelt.
[Quellen: Planetiler PLANET.md & README; Tilemaker README; geofabrik/shortbread-tilemaker]

### 3.2 Schema ↔ Stil ↔ Assets (die Kopplung, ohne Eigenentwicklung)

Das ist der heikelste Punkt: Ein Schema ist nur so nützlich wie der *fertige, frei lizenzierte*
Stil, der dazu passt und dessen Glyphs/Sprite man offline bündeln darf. Die drei tragfähigen
Kopplungen:

#### A) Protomaps Basemap v4
- **Stil:** TypeScript-Paket `@protomaps/basemaps` erzeugt MapLibre-GL-Styles in mehreren
  Flavors (**light, dark, white, grayscale, black**) — per npm oder als JSON-Export. **Lizenz:
  Stil/Design CC0, Software BSD-3.**
- **Tiles:** ODbL (Produced Work von OSM), Attribution „© OpenStreetMap".
- **Glyphs:** `basemaps-assets` enthält **Noto Sans Regular/Medium/Italic**, PBF erzeugt mit
  `font-maker`; **Lizenz OFL**. URL-Template
  `https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf`.
- **Sprite:** in `basemaps-assets/sprites/` (v3/v4, light+dark, 1×/2×), erzeugt mit `spreet`
  (aus `tangrams/icons`); **Lizenz MIT**.
- **Labels/Sprachen:** Tiles tragen `name`, `name:de`, `name:en`, … (41 Sprachen);
  zielsprachige Style-JSONs verfügbar. → deutsche Beschriftung nativ möglich.
- **Offline:** Alle Assets als ZIP herunterladbar (`Code > Download ZIP` bzw.
  Release-Artefakte) → lokal hostbar.
- **Bauen:** der Protomaps-Build *ist* ein Planetiler-Profil (`protomaps/basemaps`), Planet in
  „2–3 h auf einem bescheidenen Rechner".
[Quellen: protomaps/basemaps, basemaps-assets, docs.protomaps.com basemaps/maplibre + flavors + localization]

#### B) Shortbread (empfohlen)
- **Herkunft:** schlankes, generisches OSM-Vektorschema, ursprünglich von **Geofabrik** (DE) —
  passend „amtlich/europäisch" geprägt.
- **Stil:** `versatiles-style` erzeugt **Colorful, Graybeard, Eclipse, Neutrino, Shadow,
  Satellite** für MapLibre, plus Sprites. **Lizenz: Code Unlicense (Public Domain),
  Icons/Sprites CC0.** Programmatische Erzeugung erlaubt **lokale/relative URLs** (eigener
  `baseUrl`/`glyphs`/`sprite`). Zusätzlich `shortbread-demo-maplibre` als Minimalstil.
- **Tiles:** ODbL, Attribution „© OpenStreetMap".
- **Glyphs/Sprite:** VersaTiles liefert Fonts (`versatiles-fonts`, OFL-Open-Fonts) und Sprites
  (`sprites.tar.gz`) als Release-Artefakte → offline bündelbar.
- **Labels/Sprachen:** Schema trägt in **allen** Label-Layern `name`, **`name_de`**,
  **`name_en`** — u. a. `place_labels`, `boundary_labels`, `street_labels`,
  `water_lines_labels`, `water_polygons_labels`, `pois`, `addresses`, `public_transport`,
  `ferries`. → deutsche Beschriftung nativ, sehr label-reich.
- **Bauen:** Planetiler-Shortbread-Profil; bequemes Docker-Image
  `versatiles-org/planetiler-shortbread` (Planetiler + VersaTiles kombiniert). Alternativ
  Tilemaker via `geofabrik/shortbread-tilemaker` (+ `get-shapefiles.sh` für externe Daten wie
  Land/Ozean-Polygone).
[Quellen: shortbread-tiles.org schema/styles; versatiles-org/versatiles-style; download.versatiles.org; versatiles-org/planetiler-shortbread; geofabrik/shortbread-tilemaker]

#### C) OpenMapTiles
- **Stil:** reife Auswahl — **osm-bright, positron, dark-matter, osm-liberty** (BSD/CC0/MIT-nah).
- **Glyphs:** `openmaptiles/fonts` (Noto Sans [Klokantech-patched], Open Sans, PT Sans, Roboto,
  Metropolis) — **OFL/Apache**, lokal generierbar (`npm` + generate → `_output/`).
- **Labels/Sprachen:** `name`, `name:de`, `name:en`, `name:latin`, … vorhanden.
- **Bewertung:** voll offline-bündelbar und ausgereift, aber: Schema-/Tooling-Governance liegt
  bei MapTiler (kommerzieller Kontext), Stile sind eher schwerer/„webby" statt „amtlich", und
  populäre Fertig-Styles referenzieren teils MapTiler-/Klokantech-Hosting (muss man konsequent
  auf eigene Assets umbiegen). Funktioniert, ist hier aber gegenüber A/B die schwächere Wahl.
[Quellen: openmaptiles/fonts; openmaptiles/osm-liberty-gl-style; switch2osm MapLibre-Guide]

### 3.3 „Amtlich"-Anmutung — ehrliche Einordnung

Keiner der OSM-Stile **ist** die amtliche deutsche Karte (AdV/`basemap.de`). Das nächste an
„sauber/amtlich, voll beschriftet" out-of-the-box ist **Shortbread + VersaTiles Colorful** (dicht
beschriftet, klare Hierarchie) bzw. eine **angepasste** Protomaps-/OMT-Variante. Weil alle
empfohlenen Stile **CC0/Public Domain** sind, lassen sie sich gefahrlos Richtung amtlicher
Optik **tunen** (Farben, Straßenklassen-Hierarchie, Label-Dichte) — das ist **Aufwand**, kein
Lizenzproblem. **Konsequenz:** Die endgültige Stilwahl sollte an den **Live-Demos** getroffen
werden (siehe §9 Entscheidungs-Checkliste), nicht allein aus Beschreibungen.

---

## 4. Weg 2 — `basemap.de` (BKG/AdV) / amtliche DE-Daten offline

`basemap.de Web Vektor` ist die **amtliche** deutsche Web-Vektorkarte (AdV-Geobasisdaten,
gehostet vom BKG), in den Stilen **Farbe / Grau / Relief**, ausgeliefert über Style-JSON-URLs
(z. B. `https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json`), Tiles in
Web-Mercator (EPSG:3857). Optisch ist das **genau die „amtlich"-Anmutung**, die der Auftrag
beschreibt.

**Warum es als Offline-Basis dennoch ausscheidet — in dieser Reihenfolge:**

1. **K.-o. an Anforderung (b): nicht selbst baubar/aktualisierbar.** Die Daten stammen aus
   amtlicher Geotopografie, **nicht aus OSM**. Es gibt **keinen eigenen Build-Pfad** und **kein
   offizielles Offline-/Bulk-Download-Produkt** der Vektorkacheln. Man könnte die Karte nie
   selbst neu erzeugen oder fortschreiben — die Aktualität hinge vollständig am BKG-Dienst. Das
   verfehlt „eigenständig baubar + aktualisierbar" unabhängig von jeder Lizenz.

2. **Lizenz vs. Kanal — die Nuance (nicht „verboten", aber kein zulässiger Weg an eine
   Offline-Kopur):** Der **Inhalt** steht unter **CC-BY 4.0** bzw. **DL-DE→BY-2.0** — diese
   Lizenz ist unwiderruflich und würde Offline-Nutzung *und* Weitergabe mit Namensnennung
   grundsätzlich erlauben. Der Blocker ist der **Bezugskanal**: Es existiert **kein
   sanktioniertes Bulk-/Offline-Download-Produkt**, und die **Nutzungsbedingungen des
   Live-Dienstes** beschränken das dauerhafte Speichern/Extrahieren der über den Dienst
   ausgelieferten Daten (sinngemäß: nur in Verbindung mit dem Dienst, kein Speichern/keine
   Weiterverwendung außerhalb). Das Abgreifen („scrapen") der Live-Endpunkte zu einem
   Offline-Spiegel ist damit **rechtlich-graue Zone**, kein klar zulässiger Weg.
   → **Offene Frage / Klärungspfad:** direkte Anfrage bei BKG/GDZ, ob für Behördennutzung ein
   Offline-/Bulk-Bezug der `basemap.de`-Vektorkacheln zulässig/erhältlich ist. Erst dann
   bewertbar; **nicht** als „unmöglich" zu behaupten.

3. **Glyphs/Sprite offline:** Der amtliche Stil referenziert Glyphs/Sprite auf
   `sgx.geodatenzentrum.de`. Selbst bei zulässiger Tile-Kopie müsste man Style + Glyphs + Sprite
   mitspiegeln; deren separate Lizenz-/Font-Lage ist nicht dokumentiert geprüft.

**Empfehlung zu Weg 2:** **Nicht** als Offline-Basemap. Optional als **zusätzlicher
Online-Layer** (wenn Netz da ist) wegen der amtlichen Optik — aber das widerspricht „komplett
offline" und bringt eine Laufzeit-Fremdabhängigkeit. Für die Offline-Anforderung bleibt OSM-
Eigenproduktion der Weg.
[Quellen: basemap.de Web-Vektor-Produktseite & Doku; BKG-GDZ; Nutzungsbedingungen-PDF (Inhalt CC-BY/DL-DE-BY, Dienst-Restriktion „nicht speichern")]

---

## 5. Weg 3 — Fertige Community-/kommerzielle Extracts

| Quelle | Was | Offline? | Eigen-Build (b)? | Risiko |
|---|---|---|---|---|
| **VersaTiles Downloads** (`download.versatiles.org`) | Prebuilt **Planet** Shortbread z0–14, **~59–62 GB**; **regionale Extracts** durch lokales Filtern/Konvertieren des Remote-Containers (kein fertiges `germany.versatiles`) | ja | teils — man kann *stattdessen* selbst bauen | Daten-Hosting-Abhängigkeit vom Projekt, solange man den Prebuilt nutzt |
| **Protomaps** Prebuilt Planet PMTiles (täglich) | Single-File-Planet, Basemap v4 | ja | teils | dito; CDN/Projekt-Verfügbarkeit |
| **Geofabrik Tile Packages / `.osm.pbf` Extracts** | OSM-Rohdaten (DE 4,5 GB; DACH-Zone vorhanden) als **Build-Input** | n/a (Rohdaten) | **ja** (Basis für Eigenbau) | sehr gering (Rohdaten-Spiegel) |
| **MapTiler / Stadia Maps** (kommerziell) | gehostete Tiles/Styles, teils Self-host-Pakete | nur mit deren Paketen | **nein** out-of-the-box | **K.-o.: fremde API-Keys / Fremd-Hosting** |

**Bewertung:** Kommerzielle gehostete Dienste (MapTiler, Stadia) **scheiden an Anforderung (b)
aus** (fremde Keys/Hosting). Prebuilt-Container (VersaTiles/Protomaps) sind **legitime
Abkürzungen** und voll offline-fähig, bedeuten aber eine **Daten-Hosting-Abhängigkeit** vom
jeweiligen Projekt (Supply-Chain). Für maximale Härtung baut man **selbst** aus dem
Geofabrik-Extract — der Prebuilt ist dann nur **Bootstrap/Fallback**, nicht die Update-Quelle.

---

## 6. Vergleichstabelle der Optionen

Bewertung 1 (schwach) – 5 (stark); Offline-Vollständigkeit als Ja/Bedingt/Nein.

| Kriterium | **Shortbread + VersaTiles** (Planetiler→MBTiles) | **Protomaps v4** (Planetiler→PMTiles) | **OpenMapTiles** (Planetiler/Tilemaker) | **basemap.de** (amtlich) | **Kommerziell** (MapTiler/Stadia) |
|---|---|---|---|---|---|
| Renderqualität + Labels | 5 — dicht, full-featured, `name_de` nativ | 4 — sauber, eher zurückhaltend; Flavors | 4 — reif, „webby" | 5 — amtlich | 4–5 |
| „Amtlich"-Anmutung | 4 (tunebar) | 3–4 (tunebar) | 3 | 5 | 3–4 |
| Selbst baubar (b) | 5 (Planetiler/Tilemaker) | 5 (Planetiler) | 5 | **0 — kein Build-Pfad** | **0 — Keys/Hosting** |
| Offline Style/Glyphs/Sprite (c) | **Ja** (Unlicense/CC0/OFL) | **Ja** (CC0/BSD/OFL/MIT) | **Ja** (OFL/Apache) | **Bedingt/Nein** | Bedingt (Paket) |
| Lizenz Tiles | ODbL | ODbL | ODbL | CC-BY/DL-DE-BY | proprietär/ODbL |
| Build-Hardware DE | gering–mittel | gering–mittel | gering (Tilemaker) – mittel | – | – |
| Speichergröße DE (z0–14, geschätzt) | ~1,5–3 GB | ~2–3,5 GB | ~2,5–3,5 GB | – | – |
| Update-Pipeline | 1 Befehl, monatlich | 1 Befehl, monatlich | mehrstufiger | extern (BKG) | extern |
| Backend-Fit (Rust+SQLite) | **MBTiles = SQLite, 0 neue Deps** | PMTiles (`pmtiles`-Crate / Range) | MBTiles/PMTiles | – | – |
| Supply-Chain-Härtung | **hoch** | hoch | mittel (MapTiler-Governance) | – | **niedrig** |

---

## 7. Empfehlung mit Begründung

### 7.1 Primärempfehlung

> **Shortbread-Schema, gebaut mit Planetiler, ausgeliefert als MBTiles, mit lokal gebündelten
> OFL-Glyphs und CC0-Sprite — gestylt mit einem zurückhaltenden VersaTiles-Stil (`graybeard`/
> `eclipse`) oder einem auf eine ruhige/„amtliche" Palette getunten `colorful` (`language:'de'`).**

Hinweis zur Stilwahl: Robust und empfohlen ist das **Shortbread-Schema** als Daten-/Label-Basis.
Welcher der VersaTiles-Stile aufgesetzt wird, ist die *visuelle* Feinjustage und wird an den
Live-Demos entschieden (§9). „Colorful" maximiert Label-Dichte/„full-featured", ist aber der
**bunteste**, am wenigsten amtliche Variante; für die geforderte amtlich-anmutende Optik eher
`graybeard`/`eclipse` oder ein getuntes `colorful` (CC0 erlaubt das Tunen von Palette und
Label-Hierarchie). Default bei Unentschieden: zurückhaltend gestyltes Colorful mit `language:'de'`.

**Begründung entlang der gewichteten Faktoren:**

1. **Renderqualität + Labels (höchstes Gewicht).** Shortbread trägt in *allen* Label-Layern
   native `name`/`name_de`/`name_en`-Felder; VersaTiles Colorful ist der **dichteste,
   „full-featured" beschriftete** Fertig-Stil — genau die Anti-These zum abgelehnten
   minimalistisch/label-losen Ansatz. Schema deutscher Herkunft (Geofabrik), europäisch geprägt.
2. **Selbst-Hostbarkeit / Supply-Chain.** Eigenbau aus Geofabrik-Extract mit Planetiler;
   **Code Unlicense, Sprites CC0, Fonts OFL** → keinerlei Fremd-Key/Fremd-Hosting, sauberste
   Lizenzkette für eine Behörde.
3. **Offline-Vollständigkeit.** Style-JSON, Tiles (MBTiles), Glyph-PBFs und Sprite-Sheet sind
   alle statische Artefakte; Style mit lokalen URLs generierbar → **null externe
   Laufzeit-Abrufe**.
4. **Aufwand/Wartbarkeit.** **MBTiles *ist* SQLite** → das bestehende Rust+SQLite-Backend
   serviert Tiles mit einem einzigen `SELECT` ohne neues Format-Dependency (niedrigste
   Supply-Chain-Fläche). Update = ein Planetiler-Lauf gegen `germany-latest.osm.pbf`.

### 7.2 Gleichwertige Alternative (Co-Lead)

> **Protomaps Basemap v4 als Single-File-PMTiles + `@protomaps/basemaps` (CC0) + `basemaps-assets`.**

Vorzuziehen, **wenn** (a) die Demo-Sichtprüfung die Protomaps-Kartografie als „amtlicher"
empfindet, **oder** (b) ein **einziges, selbst-enthaltenes File** (PMTiles, ohne Tile-Server,
direkt per `pmtiles://`-Protokoll im Browser oder via Rust-`pmtiles`-Crate / HTTP-Range) als
Betriebsmodell bevorzugt wird. PMTiles glänzt bei „eine Datei = eine Region".

**Tie-Breaker (explizit):** Da „Renderqualität+Labels" das höchste Gewicht hat und es eine
**visuelle** Frage ist, wird die finale Schema/Stil-Wahl an den **Live-Demos** entschieden
(§9). Default bei Unentschieden: **Shortbread/Colorful** wegen Label-Dichte + SQLite-Fit.

### 7.3 Was NICHT empfohlen wird
- **`basemap.de` als Offline-Basis** (nicht selbst baubar; Offline-Bezug ungeklärt) — höchstens
  optionaler Online-Layer.
- **Kommerziell gehostet** (MapTiler/Stadia) — verletzt „keine fremden Keys/kein Fremd-Hosting".
- **Prebuilt-Container als *Update-Quelle*** — als Bootstrap ok, aber für Härtung selbst bauen.

---

## 8. Konkrete reproduzierbare Pipeline

Annahme: Linux-Build-Host (oder macOS) mit Java 21, Docker, Node ≥ 20; Ziel **Deutschland**
(DACH analog mit `--area=dach` bzw. DACH-Extract). Pfade exemplarisch.

### 8.1 Build — Tiles erzeugen

**Variante A — Shortbread mit Planetiler (empfohlen, via VersaTiles-Docker):**
```bash
# Lädt Geofabrik-Extract automatisch, baut Shortbread-MBTiles (z0–14)
docker run --rm -v "$PWD/data:/data" \
  ghcr.io/versatiles-org/planetiler-shortbread \
  --download --area=germany \
  --output=/data/germany.shortbread.mbtiles
# (Flags ggf. an Repo-README angleichen; Output ebenso als .pmtiles möglich)
```

**Variante A' — Shortbread/OpenMapTiles/Protomaps direkt mit Planetiler-JAR:**
```bash
# OpenMapTiles-Default:
java -Xmx8g -jar planetiler.jar --download --area=germany \
  --output=data/germany.mbtiles
# Für Protomaps-Profil bzw. Shortbread: jeweiliges Profil/Repo nach dessen README bauen.
```

**Variante B — RAM-arm mit Tilemaker (Shortbread):**
```bash
git clone https://github.com/geofabrik/shortbread-tilemaker && cd shortbread-tilemaker
./get-shapefiles.sh                     # externe Land-/Ozean-Polygone etc.
wget https://download.geofabrik.de/europe/germany-latest.osm.pbf
tilemaker --input germany-latest.osm.pbf --output germany.shortbread.mbtiles \
  --config config.json --process process.lua --store /mnt/ssd/tmp
```

**Variante C — Protomaps PMTiles (Single-File):** Build über das `protomaps/basemaps`-
Planetiler-Profil (siehe dessen README), Output `germany.pmtiles`.

> **Größen/Zeit (geschätzt, mit `*` markiert):** Planet Shortbread z0–14 ≈ 59–62 GB (belegt).
> Deutschland z0–14: **~1,5–3 GB Shortbread / ~2–3,5 GB OMT** (`*`Schätzung, abgeleitet aus
> Geofabrik DE-pbf 4,5 GB und NL 1,1 GB pbf → 700 MB OMT-MBTiles). DACH ≈ +~35 % (`*`). Build-
> Zeit DE mit Planetiler auf modernem Multicore: **Minuten bis wenige Zehn-Minuten** (`*`;
> Referenz Planet 3 h 21 min). Skaliert mit Schema, `maxzoom` und Building-Merge (Letzteres
> kostet ~14 CPU-h beim Planeten → für DE klein, aber abschaltbar).

### 8.2 Style + Glyphs + Sprite — offline-Assets erzeugen

**Glyphs (SDF-PBFs aus Open-Fonts):**
```bash
# Option 1: openmaptiles/fonts (Noto/Open Sans/Roboto …, OFL/Apache)
git clone https://github.com/openmaptiles/fonts && cd fonts
npm install && npm run generate      # generate-Script → _output/<Fontstack>/{0-255 …}.pbf
                                     # (exakten Script-Namen gegen Repo-README prüfen)
# Option 2: build_pbf_glyphs <ttf-dir> <out-dir>   (Rust-CLI)
# Option 3: MapLibre FontMaker (Web/CLI) → ZIP mit 0-255.pbf … 65280-65535.pbf
```

**Sprite (Icon-Atlas aus SVGs):**
```bash
# spreet (Rust): erzeugt sprite.png/.json (+ @2x)
spreet ./icons_src ./dist/sprites/colorful
spreet --retina ./icons_src ./dist/sprites/colorful@2x
```

**Style-JSON mit lokalen URLs (VersaTiles, Shortbread):** `@versatiles/style` ist eine
**JS-Library** (kein CLI). Style programmatisch erzeugen und glyphs/sprite/tiles auf lokale
Pfade biegen. Verfügbare Funktionen: `colorful()`, `graybeard()`, `eclipse()`, `neutrino()`,
`shadow()`, `satellite()`, sowie `guessStyle()`; Optionen über `StyleBuilderOptions` (u. a.
`language: 'de'`, `colors`, `recolor`). Die exakten URL-Override-Felder gegen die aktuelle
`StyleBuilderOptions`-Doku prüfen (`*`schematisch):
```js
// build-style.mjs (Node)
import { colorful } from "@versatiles/style";
import { writeFileSync } from "node:fs";

const style = colorful({
  language: "de",                                   // deutsche Labels bevorzugen
  // URL-Overrides je nach StyleBuilderOptions-API:
  // glyphs:  "/maps/fonts/{fontstack}/{range}.pbf",
  // sprite:  "/maps/sprites/colorful",
  // tiles:   ["/maps/tiles/{z}/{x}/{y}"],
});
// Fallback, falls Overrides nicht als Option vorliegen: nach dem Erzeugen patchen
style.glyphs = "/maps/fonts/{fontstack}/{range}.pbf";
style.sprite = "/maps/sprites/colorful";
style.sources[Object.keys(style.sources)[0]].tiles = ["/maps/tiles/{z}/{x}/{y}"];
writeFileSync("dist/style.json", JSON.stringify(style, null, 2));
// (Bei Protomaps analog: @protomaps/basemaps-Style exportieren, glyphs/sprite/tiles umbiegen.)
```

Resultierendes `style.json` (Auszug, alles lokal):
```json
{
  "version": 8,
  "glyphs": "/maps/fonts/{fontstack}/{range}.pbf",
  "sprite": "/maps/sprites/colorful",
  "sources": {
    "shortbread": {
      "type": "vector",
      "tiles": ["/maps/tiles/{z}/{x}/{y}"],
      "minzoom": 0, "maxzoom": 14,
      "attribution": "© OpenStreetMap contributors"
    }
  },
  "layers": [ "… aus VersaTiles Colorful …" ]
}
```

### 8.3 Hosting/Artefakte — Auslieferung durch das Rust-Backend

- **Tiles (MBTiles = SQLite):** Das Backend öffnet die `*.mbtiles` als SQLite-DB und beantwortet
  `GET /maps/tiles/{z}/{x}/{y}` mit
  ```sql
  SELECT tile_data FROM tiles
  WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3;
  ```
  **Achtung TMS-Y-Flip:** MBTiles speichert `tile_row` in TMS-Orientierung → `tile_row =
  (2^z − 1) − y` gegenüber dem XYZ-`y` aus MapLibre. Header setzen: `Content-Type:
  application/x-protobuf`, `Content-Encoding: gzip` (MVT in MBTiles ist gzip-komprimiert).
  → **Kein neues Format-Dependency** (nutzt die vorhandene `sqlx`/SQLite-Schicht).
- **Glyphs/Sprite/Style:** als statische Dateien aus einem Verzeichnis bzw. ins Binary
  eingebettet (das Frontend ist ohnehin via `rust-embed` eingebettet — Karten-Assets können
  separat als Daten-Verzeichnis liegen, da sie regions-/größenabhängig sind).
- **PMTiles-Alternative:** entweder Rust-`pmtiles`-Crate (wird u. a. von Martin genutzt) zum
  z/x/y-Servieren, **oder** die `*.pmtiles` als einzelne statische Datei ausliefern und im
  Browser direkt per `pmtiles://`-Protokoll lesen (HTTP-Range) — dann ganz ohne Tile-Endpoint.

### 8.4 Offline-Auslieferung — Bündelung

Ein Karten-Artefakt-Bundle pro Region, z. B.:
```
maps/
  germany.shortbread.mbtiles      # Tiles (SQLite)
  style.json                      # lokale URLs
  fonts/<Fontstack>/{range}.pbf   # Glyphs (OFL)
  sprites/colorful.{png,json}     # + @2x
  ATTRIBUTION.txt                 # "© OpenStreetMap contributors" (ODbL)
```
Dieses Bundle wird in der Prep-Phase einmalig geladen/installiert und danach **vollständig
lokal** bedient. Es gibt **keinen** Laufzeit-Abruf nach außen (Style, Glyphs, Sprite, Tiles
allesamt lokal). Passt zum bestehenden Offline-Karten-Download/-Aktivierungs-Flow (LFH-181).

### 8.5 MapLibre-Frontend-Einbindung

```js
import maplibregl from "maplibre-gl";
// nur falls PMTiles statt MBTiles genutzt wird:
// import { Protocol } from "pmtiles";
// const p = new Protocol(); maplibregl.addProtocol("pmtiles", p.tile);

const map = new maplibregl.Map({
  container: "karte",
  style: "/maps/style.json",     // referenziert lokal: glyphs, sprite, tiles
  center: [10.0, 51.0], zoom: 6,
});
```
Attribution-Control mit „© OpenStreetMap contributors" sichtbar halten (ODbL-Pflicht; im
`style.json` bereits als `attribution` gesetzt, MapLibre zeigt sie an).

### 8.6 Aktualisierung

- **Tiles:** monatlicher (oder bedarfsgesteuerter) Re-Build:
  ```bash
  docker run --rm -v "$PWD/data:/data" ghcr.io/versatiles-org/planetiler-shortbread \
    --download --area=germany --output=/data/germany.shortbread.mbtiles
  ```
  Neues MBTiles als neues Bundle-Artefakt ausliefern; der bestehende Download-/Aktivierungs-
  Mechanismus (LFH-181) tauscht die aktive Basemap.
- **Style/Glyphs/Sprite:** ändern sich nur bei bewusstem Versions-Bump des Stils → selten, separat
  versioniert. Glyphs/Sprite einmal erzeugen, einchecken/mitliefern.
- **Reproduzierbarkeit:** Build-Befehl + Toolchain-Versionen (Planetiler-/VersaTiles-Image-Tag,
  Geofabrik-Datum) festhalten; OSM-Eingabe ist datiert (`*-YYMMDD`).

---

## 9. Entscheidungs-Checkliste (vor Umsetzung)

1. **Live-Demos sichten** und Kartografie vergleichen (höchstes Gewicht = visuell):
   - VersaTiles Colorful / Shortbread: `https://vector.openstreetmap.org/demo/shortbread/`,
     VersaTiles-Demo
   - Protomaps Flavors: `https://maps.protomaps.com`
   - OpenMapTiles osm-bright/osm-liberty
   → Stil festlegen (Default Shortbread/Colorful).
2. **Container** bestätigen: MBTiles (SQLite-Fit, empfohlen) vs. PMTiles (Single-File).
3. **Region**: DE vs. DACH (Größen-/Zeit-Budget, §8.1).
4. **`maxzoom`**: z14 Standard; ggf. höher für ELW-Detailgrad (Tile-Größe steigt).
5. **BKG-Anfrage** (optional/parallel): Offline-/Bulk-Bezug `basemap.de`-Vektor für
   Behördennutzung zulässig? (klärt Weg 2).

---

## 10. Risiken & offene Fragen

| Thema | Risiko / offene Frage | Mitigation |
|---|---|---|
| **`basemap.de` Offline-Lizenz/Kanal** | Inhalt CC-BY/DL-DE-BY (erlaubt offline), aber kein zulässiger Bezugskanal; Scraping = Grauzone | BKG/GDZ direkt anfragen; bis dahin nicht als Offline-Basis nutzen |
| **„Amtlich"-Anmutung** | Kein OSM-Stil ist die amtliche Karte; Erwartung „amtlich" nur durch Stil-Tuning näherbar | Stil-Tuning einplanen (CC0 erlaubt es); Erwartung early mit Demos abgleichen |
| **Region-Größen/Zeiten** | DE/DACH-Zahlen sind **Schätzungen** (`*`), nicht gemessen | Einmal real bauen und Werte verankern |
| **Schema↔Stil-Versionierung** | Stil-Update kann Glyph-/Sprite-Erwartung ändern (neue Fontstacks/Icons) | Style + Glyphs + Sprite gemeinsam versionieren/mitliefern |
| **MBTiles Y-Flip & gzip** | Falscher `tile_row`/fehlender `Content-Encoding` → leere/kaputte Tiles | TMS-Flip + gzip-Header testen (z/x/y-Smoke) |
| **Prebuilt-Container-Abhängigkeit** | Wer Prebuilt als Update-Quelle nutzt, hängt am Projekt-Hosting | Selbst bauen; Prebuilt nur Bootstrap/Fallback |
| **Glyph-Sprachabdeckung** | Sonderzeichen/Diakritika fehlen, wenn Fontstack unvollständig | Vollständige Noto/Open-Font-Ranges generieren; deutsche Labels (`name_de`) im Stil bevorzugen |
| **Disk/Build-Host** | Planet-Builds brauchen 5–10× pbf temporär; DE unkritisch, DACH+ größer | Auf DE/DACH beschränken; SSD-Spill bzw. Tilemaker-Fallback |
| **Attribution offline** | ODbL „© OpenStreetMap contributors" muss sichtbar bleiben | Im `style.json` als `attribution`; UI-Control aktiv lassen |
| **Lagekarte-Render-Integration** | Custom-Layer/`setStyle`/`setData`-Timing (bekannte MapLibre-Gotchas im Projekt) | Bestehende `wendeKartenDatenAn`-/render-Frame-Pattern beibehalten |

---

## 11. Quellen

**Builder / Tile-Produktion**
- Planetiler (GitHub): https://github.com/onthegomap/planetiler
- Planetiler PLANET.md (Hardware/Zeit/Format): https://github.com/onthegomap/planetiler/blob/main/PLANET.md
- Planetiler (OSM-Wiki): https://wiki.openstreetmap.org/wiki/Planetiler
- Planetiler vs. Tilemaker (Discussion #16): https://github.com/onthegomap/planetiler/discussions/16
- Tilemaker (GitHub): https://github.com/systemed/tilemaker
- Geofabrik Tile Packages: https://www.geofabrik.de/maps/tile-packages.html
- Geofabrik Tile Calculator: https://tools.geofabrik.de/calc/

**Schema: Shortbread / VersaTiles**
- Shortbread Tiles (Projekt): https://shortbread-tiles.org/
- Shortbread Schema 1.0 (Label-/Name-Felder): https://shortbread-tiles.org/schema/
- Shortbread Styles: https://shortbread-tiles.org/styles/
- Shortbread mit Tilemaker: https://shortbread-tiles.org/make-vectortiles/tilemaker/
- geofabrik/shortbread-tilemaker: https://github.com/geofabrik/shortbread-tilemaker
- VersaTiles Style (Toolkit, Lizenzen): https://github.com/versatiles-org/versatiles-style
- VersaTiles Doku: https://docs.versatiles.org/
- VersaTiles Downloads (Container-Größen): https://download.versatiles.org/
- versatiles-org/planetiler-shortbread (Docker): https://github.com/versatiles-org/planetiler-shortbread
- Shortbread-Einführung (Customizing): https://pka.github.io/customizing-shortbread-vector-tiles/

**Schema: Protomaps Basemap v4**
- protomaps/basemaps (Build/Stile/Lizenz): https://github.com/protomaps/basemaps
- basemaps-assets (Fonts OFL / Sprites MIT, offline): https://github.com/protomaps/basemaps-assets
- Protomaps Docs — MapLibre/Offline (glyphs/sprite-URLs): https://docs.protomaps.com/basemaps/maplibre
- Protomaps Docs — Flavors: https://docs.protomaps.com/basemaps/flavors
- Protomaps Docs — Localization (name:de, 41 Sprachen): https://docs.protomaps.com/basemaps/localization
- Protomaps Docs — PMTiles für MapLibre: https://docs.protomaps.com/pmtiles/maplibre
- Offline-Maps-Beispiel (Blog): https://blog.wxm.be/2024/01/14/offline-map-with-protomaps-maplibre.html

**Schema: OpenMapTiles**
- openmaptiles/fonts (OFL/Apache, lokal generierbar): https://github.com/openmaptiles/fonts
- osm-liberty-gl-style: https://github.com/openmaptiles/osm-liberty-gl-style
- switch2osm — MapLibre Getting Started: https://switch2osm.org/using-tiles/getting-started-with-maplibre/

**Glyphs / Sprite / MapLibre-Style**
- MapLibre Style Spec — Glyphs: https://maplibre.org/maplibre-style-spec/glyphs/
- MapLibre Style Spec — Sprite: https://maplibre.org/maplibre-style-spec/sprite/
- MapLibre FontMaker (TTF→PBF): (Projekt-Repo MapLibre Font Maker)
- spreet (Sprite-Generator, Rust): genannt in Stadia-Maps-Doku https://docs.stadiamaps.com/custom-styles/

**Amtlich: basemap.de / BKG**
- basemap.de Web Vektor (Produkt): https://basemap.de/produkte-und-dienste/web-vektor/
- BKG-GDZ basemap.de Webdienste: https://gdz.bkg.bund.de/index.php/default/webdienste/basemap-webdienste.html
- BKG-GDZ Vector Tiles basemap.de Web Vektor: https://gdz.bkg.bund.de/index.php/default/gdz-basemapde-vektor-gdz-basemapde-vektor.html
- Nutzungsbedingungen basemap.de (PDF, CC-BY/DL-DE-BY + Dienst-Restriktion): https://sgx.geodatenzentrum.de/web_public/gdz/lizenz/deu/nutzungsbedingungen_basemapde.pdf
- Doku basemap.de Web Vektor (PDF): https://sgx.geodatenzentrum.de/web_public/gdz/dokumentation/deu/basemap.de_web_vektor.pdf

**Daten / Extracts**
- Geofabrik Germany: https://download.geofabrik.de/europe/germany.html
- Geofabrik DACH: https://download.geofabrik.de/europe/dach.html

> Hinweis: Mit `*` markierte Größen-/Zeitangaben für Deutschland/DACH sind **Schätzungen**,
> abgeleitet aus belegten Referenzwerten (Planet-Builds, NL-Extract, Geofabrik-pbf-Größen,
> VersaTiles-Planet-Container) und vor Umsetzung durch einen realen Build zu verifizieren.
