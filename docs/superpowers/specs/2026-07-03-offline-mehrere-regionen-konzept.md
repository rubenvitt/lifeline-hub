# Offline-Lagekarte: mehrere heruntergeladene Regionen gleichzeitig (Konzept)

**Task:** LFH-188 · **Stand:** 2026-07-03 · **Status:** Konzept (entscheidungsreif) —
Umsetzung ist ein Folge-Task.

## Kontext

Mit dem Offline-Karten-Manager (LFH-181) kann ein Admin mehrere MBTiles-Regionen
herunterladen. Technisch ist heute aber erzwungen, dass nur **eine** Region gleichzeitig
auf der Lagekarte sichtbar ist. Lädt der Nutzer zwei angrenzende Gebiete (z.B. zwei
benachbarte Landkreise eines Einsatzraums), sieht er immer nur eines und muss in der
Admin-Tabelle umschalten.

Dieses Dokument entscheidet den Ansatz und skizziert Datenmodell + UX als Grundlage für die
Umsetzung. **Kein Code** in diesem Task.

### Nutzungsszenario (festgelegt)

**Wenige, oft angrenzend:** 2–4 heruntergeladene Regionen, die zusammen ein größeres
Einsatzgebiet abdecken; Grenzen berühren sich, Lücken dazwischen sind normal. Kein
national-großflächiges Kachel-Assembling.

## Ist-Zustand: „genau eine aktiv" ist auf vier Ebenen zementiert

| Ebene | Ort | Mechanik |
|---|---|---|
| DB-Constraint | `migrations/0076_karte_registry.sql` `idx_offline_eine_aktive` | partieller Unique-Index: nur eine Zeile mit `aktiv_basemap = 1` |
| Repo | `repo::aktiviere_offline_karte` | aktiviert **exklusiv** (deaktiviert erst alle anderen) |
| Config | `routes::karte::config` | liefert genau **ein** `offline_tiles_url` (aus `repo::aktive_offline_karte`) |
| Frontend-Style | `frontend/.../basemapStil.ts` `offlineStyle()` | genau **eine** Vector-Source `basemap` + ein 6-Layer-Set |
| Frontend-API/UI | `api/karte.ts` `KarteServerConfig`, `karten/OfflineKartenVerwaltung.tsx` | ein `offline_tiles_url`; „Aktivieren"-Button = Single-Toggle (serverseitig exklusiv) |

> Hinweis: Der Wechsel PMTiles → selbst-serviertes Shortbread-MBTiles (LFH-195) hat die
> Invariante eher **fester** verankert (ein einziger Tile-Endpoint). Feld-/Pfad-Namen der
> ursprünglichen LFH-188-Beschreibung sind gedriftet: `pmtiles_url` → `offline_tiles_url`,
> „PMTiles-Source" → selbst-servierte `tiles:[…]`-Vector-Source, `pages/lagekarte/` → teils
> `karten/`.

## Entscheidung: Ansatz A (mehrere aktive Vector-Sources)

Das Frontend bindet **je sichtbarer Region eine eigene Vector-Source** in den Offline-Style
ein; der Server bleibt bei einer MBTiles-Datei pro Region und serviert region-adressierte
Kacheln. Die „genau eine aktiv"-Invariante wird zu „mehrere sichtbar erlaubt" gelockert.

### Warum nicht Ansatz B (serverseitiger Merge)

Ansatz B würde mehrere MBTiles beim/nach dem Download zu **einer** kombinierten Datei
zusammenführen (Lagekarte bliebe bei einer Source). Dagegen:

- **Gegen das Projektprinzip** „alles in-App, kein externer Tile-Service / kein Docker":
  Merge braucht ein Tile-Tool (tippecanoe / pmtiles-/mbtiles-merge) **zur Laufzeit im
  Binary** — genau die Art externer/schwerer Toolchain, die das Projekt bewusst meidet.
- **Re-Merge bei jedem Download/Update**, Tile-Konflikt-Auflösung an Überlappungen,
  ~doppelter Disk-Verbrauch (Einzeldateien + Merge-Ergebnis).
- Rechtfertigt sich erst bei „viele / großflächig" — **nicht** das festgelegte Szenario.

Ansatz A ist für „wenige, angrenzend" der kleinere, prinzipientreue Schnitt: eine
Migration + eine Config-Feld-Erweiterung + eine Style-Generierungs-Schleife.

## Ziel-Datenmodell

- **Neue Migration ≥ 0081:** partiellen Unique-Index `idx_offline_eine_aktive` **droppen**
  (rein additiv/DDL, kein Table-Rebuild nötig — `DROP INDEX`). `aktiv_basemap` bleibt als
  Bool-Flag, Bedeutung wechselt von „die eine Basemap" zu „**sichtbar**"; mehrere Zeilen
  dürfen `aktiv_basemap = 1` tragen.
- **`repo::aktiviere_offline_karte`** (heute exklusiv) → wird zu einem nicht-exklusiven
  `setze_sichtbar(id, sichtbar: bool)` (setzt nur die eine Zeile, deaktiviert die anderen
  **nicht** mehr).
- **`repo::aktiviere_wenn_keine_aktive`** (erste bereite Region automatisch sichtbar
  schalten) bleibt sinnvoll als Erst-Aktivierungs-Komfort.
- **Leser-Queries:** `aktive_offline_karte` (Einzelzeile) → `sichtbare_offline_karten`
  (Liste), analog `aktive_offline_karte_pfad` → Auflösung per Region-`id`.

## Config & Serving

- **`/api/karte/config`:** statt einem `offline_tiles_url` eine **Liste**
  `offline_regionen: [{ karte_id, name, tiles_url, attribution }]` (alle sichtbaren, bereiten
  Regionen). `offline_verfuegbar` = Liste nicht leer. Cache-Bust `?v=<version>` **pro
  Region** (deren `sha256`/`geaendert_at`, wie heute).
  - **API-Kompatibilität:** additive Feld-Erweiterung. Übergangsweise kann `offline_tiles_url`
    als „erste sichtbare Region" weitergeliefert werden, damit alte Clients degradieren; neues
    Feld ist die Quelle der Wahrheit. Frontend-Vertrag (`KarteServerConfig`) entsprechend
    erweitern.
- **Region-adressierter Tile-Endpoint:** `/api/karte/offline/{karte_id}/tiles/{z}/{x}/{y}`
  (liest die MBTiles der `karte_id` read-only; `204`, wenn die Region nicht `sichtbar`/`bereit`
  ist). Der bestehende `/api/karte/offline/tiles/{z}/{x}/{y}` kann als Alias auf die erste
  sichtbare Region bestehen bleiben (Rückwärtskompatibilität) oder entfallen.
  - Reader-Cache (`mbtiles::reader_fuer`) ist bereits **per Pfad** gekeyt → trägt N gleichzeitig
    offene Regionen ohne Änderung; nur die aktuelle „genau ein Reader"-Annahme in Kommentaren
    aktualisieren.

## Frontend

- **`offlineStyle()`** nimmt statt einer `tilesUrl` eine **Liste** `regionen` und erzeugt je
  Region:
  - eine Vector-Source `basemap-{karte_id}` (`tiles: [tilesUrl]`, `minzoom 0`, `maxzoom 14`),
  - das bestehende 6-Layer-Set (`land`/`water_polygons`/`buildings`/`streets`/`street_labels`/
    `place_labels`), mit `source` und eindeutigen Layer-IDs je Region (`{layer}-{karte_id}`).
  - Theme-Farben identisch über alle Regionen → visuell konsistent.
- **Attribution:** über alle sichtbaren Regionen **dedupliziert** (i.d.R. identisch,
  © OpenStreetMap) — nicht N-fach anzeigen. `aktuelleAttribution`/`config.offline_attribution`
  entsprechend auf die Menge der sichtbaren Regionen umstellen.
- **Cache-Bust/Umschalter:** `?v=` pro Region; der Online/Offline-Umschalter bleibt
  unverändert (Offline zeigt jetzt die Vereinigung).

## UX

- **Verwaltungstabelle (`OfflineKartenVerwaltung.tsx`):** der „Aktivieren"-Button wird zu
  einem **„Sichtbar"-Schalter** (Switch/Checkbox) pro bereiter Region — mehrere gleichzeitig
  aktivierbar, ohne die anderen zu verdrängen. Spalte „Basemap aktiv" → „Sichtbar".
- **Erst-Verhalten:** die erste heruntergeladene Region wird automatisch sichtbar (Komfort,
  wie heute). Weitere schaltet der Nutzer additiv zu.
- **Verhalten an Grenzen:** Lücken zwischen nicht-angrenzenden Regionen bleiben leer
  (Blind-Hintergrund) — erwartet und akzeptiert.

## Risiken & offene Punkte

- **Performance:** N Vector-Sources = N Tile-Fetch-Ströme + N×6 Layer. Bei 2–4 Regionen
  unkritisch (MapLibre-typisch problemlos). Empfehlung: weiche Obergrenze/Hinweis, wenn viele
  Regionen gleichzeitig sichtbar geschaltet werden.
- **Tile-Überlappung an Regionsgrenzen:** überlappen zwei Regionen (nicht sauber
  aneinander geclippt), werden gleiche Features doppelt gezeichnet (mögliche Kanten/Z-Fighting
  bei Labels). Für angrenzende, sauber geschnittene Extrakte meist unsichtbar; als spätere
  Option ein per-Region-bbox-Clip (`maxbounds` je Source bzw. Layer-Filter).
- **Attribution-Dedup** ist Pflicht (Lizenz + Optik).
- **API-Kompatibilität:** Config-Feld additiv; alte Frontend-Builds degradieren auf die erste
  Region bzw. „nichts".
- **Sequencing mit LFH-187/B3 (wichtig):** Der Umbau berührt genau `aktiviere_offline_karte`,
  `ersetze_aktive_offline_karte` und `idx_offline_eine_aktive` — dieselben Artefakte, die der
  In-Place-Hot-Swap (LFH-187/B3, gemergt) anfasst. `ersetze_aktive_offline_karte` verlässt sich
  heute auf „deactivate all where aktiv=1"; nach Wegfall des Unique-Index muss diese Logik so
  umgebaut werden, dass ein Update nur die betroffene Region ersetzt, ohne die Sichtbarkeit der
  anderen zu ändern. Der In-Place-Reload (`offline_neu_laden`) ist davon kaum betroffen (er
  fasst die Aktiv-Anzahl nicht an), der Neu-Zeile-Update-Pfad schon.

## Akzeptanzkriterien (Konzept) — Abgleich

- [x] Entscheidung Ansatz A vs. B dokumentiert, mit Begründung → **A**, s. oben.
- [x] Skizze der nötigen Datenmodell-Änderung (Ablösung/Lockerung von
      `idx_offline_eine_aktive`) → Migration ≥0081 `DROP INDEX` + `aktiv_basemap` als „sichtbar".
- [x] UX-Skizze, wie der Nutzer mehrere Regionen gemeinsam sichtbar schaltet → „Sichtbar"-
      Schalter pro Region, mehrfach.
- [x] Offene Risiken benannt (Performance, Tile-Überlappung, Attribution) → s. Risiken.

## Grobe Umsetzungs-Schritte (für den Folge-Task)

1. Migration ≥0081: `DROP INDEX idx_offline_eine_aktive`.
2. Repo: `aktiviere_offline_karte` → `setze_sichtbar`; `aktive_offline_karte(_pfad)` →
   `sichtbare_offline_karten`; `ersetze_aktive_offline_karte` an Multi-Sichtbar anpassen.
3. Config: `offline_regionen`-Liste + Kompat-`offline_tiles_url`; region-adressierter
   Tile-Endpoint.
4. Frontend: `offlineStyle()` auf N Regionen; `KarteServerConfig`; Attribution-Dedup.
5. UI: „Sichtbar"-Schalter (mehrfach) in der Verwaltungstabelle.
6. Tests: Repo (mehrere sichtbar), Config (Liste), `offlineStyle` (N Sources), UI-Toggle.

## Referenzen

- Vorgänger: LFH-181 (Offline-Karten-Manager), LFH-195 (Shortbread/MBTiles-Umstellung),
  LFH-187 (Download-Härtung + In-Place-Hot-Swap — Sequencing).
- `migrations/0076_karte_registry.sql`, `src/karte/registry/repo.rs`, `src/routes/karte.rs`,
  `frontend/src/pages/lagekarte/basemapStil.ts`, `frontend/src/api/karte.ts`,
  `frontend/src/karten/OfflineKartenVerwaltung.tsx`.
