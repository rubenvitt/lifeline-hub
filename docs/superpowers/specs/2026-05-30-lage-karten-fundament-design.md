# L‑1 — Karten-Fundament

**Teilprojekt:** 4 „Lage" — Spec **1 von 3** (Unterbau). Erste Spec der Lage-Sequenz:
stellt eine Einsatz-**Karte** (MapLibre GL, offline-fähig) bereit, die die *bereits
erfassten* verortbaren Objekte zeigt und verortbar macht. Legt das Geo-/Karten-Fundament
(Basemap-Bereitstellung, Koordinaten direkt am Objekt, Marker-Rendering, Live), das
**L‑2 (taktische Gliederung / DV 102)** und **L‑3 (Gefahren-/Absperrzonen)** wiederverwenden —
analog wie K&M‑1 die Dispositions-Mechanik und E‑1 das Sensible-Daten-Modell legten.

**Unterbau (wiederverwendet, nicht neu gebaut):** Einsatz-Kopf mit
`einsatzort_lat`/`einsatzort_lon` (`src/einsatz/`, Migr. `0005`), UHS-Entity
([E‑3](2026-05-28-erfassung-unfallhilfsstellen-design.md), `src/uhs/`) und Schaden-Entity
([E‑5](2026-05-29-erfassung-schaeden-design.md), `src/schaden/`, `einsatz_schaden`) als die
verortbaren Objekte, deren PATCH-/SSE-/ETB-Mechanik bereits steht; Rollen-/Nachlauf-Gate
(`src/einsatz/berechtigung.rs`), SSE-Live (`sse_uhs`/`sse_schaden`), das Frontend-Muster
der bestehenden AntD-Listenseiten (React + Ant Design + React-Query + EventSource).
„Lagekarte" ist im [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) eigene
Kategorie, Status `geplant` (heute `ModulStub`).

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 4 — Lage".

## Worum es geht

Die vorigen Teilprojekte haben Kräfte, Mittel und betroffene Subjekte/Objekte erfasst —
aber alles ortsbezogene Wissen liegt bisher als **Freitext** vor (`uhs.standort`,
`einsatz_schaden.ort`). Genau das hatten E‑3 und E‑5 bewusst auf „T4 Lagekarte" vertagt
(E‑5: `ort` ist „ablösbares Freitext-Feld", „Koordinaten **nachziehen**, sobald T4 läuft";
E‑3: „`standort` wird in T4 ggf. um Geo-Koordinaten **ergänzt**"). Die Einsatzdaten-Spec
hat den **Karten-Picker für den Einsatzort** ebenfalls „später ins Lage-Modul" geschoben.

L‑1 löst diese Versprechen ein: eine Karte, auf der man die schon erfassten Objekte
**sieht** und **verortet**. Bewusst klein — das Fundament, kein Voll-Lagebild. Drei Punkte
prägen das Design:

1. **Verorten statt neu erfassen.** L‑1 legt keine neue fachliche Entität an. Es ergänzt
   die bestehenden Objekte um eine Koordinate und rendert sie. Anlegen/Bearbeiten/Storno
   bleiben in den Fach-Modulen (UHS, Schäden).
2. **Eine Wahrheit.** Die Koordinate gehört zum Objekt-Datensatz (Option „entity-gekoppelt",
   s. Annahme 1) — kein separater Marker-/Overlay-Layer, keine Schattentabelle, keine Drift.
   Der Marker *ist* das Objekt.
3. **Offline-fähig.** Das Produkt ist self-hostbar, lokal im ELW, ggf. ganz ohne Netz. Die
   Basemap-Bereitstellung ist deshalb eine echte Architektur-Entscheidung, kein Beiwerk
   (s. Annahme 4).

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Koordinaten direkt am Objekt (entity-gekoppelt).** `uhs` und `einsatz_schaden` bekommen
   je `lat REAL NULL` + `lon REAL NULL`. Kein Mehrspalten-CHECK (analog `einsatz`; beide NULL
   = nicht verortet, beide gesetzt = verortet — die App behandelt „nur eins gesetzt" nicht
   als gültigen Zustand, setzt aber stets beide gemeinsam). Freitext `standort`/`ort` bleibt
   unverändert erhalten. **Verworfen:** separater `lage_objekt`-Overlay-Layer (zweite
   Wahrheitsquelle → Drift, „welcher Marker = welches Objekt"-Problem, widerspricht dem
   projektweiten „eine Wahrheit, kein Voll-Snapshot"-Prinzip) und Hybrid (für L‑1
   over-scoped; der entitätslose freie Layer gehört nach L‑3).
2. **L‑1-Umfang = Einsatzort + UHS + Schäden.** Einsatzort hat seine Koordinaten schon
   (`einsatzort_lat/lon`) — L‑1 rendert ihn und macht ihn **per Karte editierbar** (löst den
   vertagten Einsatzort-Karten-Picker ein). UHS und Schäden werden verortbar gemacht.
3. **Fahrzeuge sind NICHT in L‑1.** `fahrzeug.standort` ist die *Wache* (Organisations-Stamm,
   Freitext), kein operativer Lage-Marker. Der operative Fahrzeug-Standort im Einsatz ist
   der FMS-Status, nicht ein editierbares `lat/lon` — das gehört nach **L‑2 (taktische
   Gliederung)**.
4. **Basemap: offline-first PMTiles + Online-URL, beides konfigurierbar.** Der Server liefert
   eine konfigurierte **PMTiles-Datei** (lokaler Pfad via CLI/ENV) per HTTP-Range aus; das
   Frontend rendert sie mit MapLibre GL über das `pmtiles`-Protokoll. Zusätzlich ist eine
   **Online-Style-URL** konfigurierbar (aktueller, wenn Netz da ist). Bevorzugung zur
   Laufzeit: **online (falls erreichbar) → Fallback lokale PMTiles → Blind-Modus** (neutrales
   Raster, Marker + Koordinaten funktionieren weiterhin). Umschalter in der Karten-Toolbar.
   **Verworfen:** nur Online-URL (bricht im ELW ohne Netz); Tiles fest ins Single-Binary
   bündeln (unflexibel, bläht das Binary auf — DE-weit mehrere GB).
5. **Verorten erzeugt keinen eigenen ETB-Eintrag.** Das reine Setzen/Korrigieren einer
   Koordinate ist eine Lage-Pflege-Handlung, kein sinntragendes Ereignis — konsistent mit der
   projektweiten „ETB nur für sinntragende Ereignisse, kein Spam"-Linie. (Anlegen/Storno des
   Objekts schreiben bereits in den Fach-Modulen ihre ETB-Spur.)
6. **Live über bestehende SSE-Kanäle.** Verorten ist ein PATCH auf das Objekt; die schon
   vorhandenen `sse_uhs`/`sse_schaden` feuern dabei — die Karte aktualisiert Marker live ohne
   neuen Kanal. Storno eines Objekts entfernt seinen Marker automatisch (alle Lese-Queries
   filtern bereits `storniert_at IS NULL`), kein „Marker-Leichen"-Problem.
7. **Manuelles Platzieren, kein Geocoding.** L‑1 verortet per Klick auf die Karte (oder
   manueller Lat/Lon-Eingabe). Automatisches Geocoding aus der Freitext-Adresse braucht einen
   Geocoder und ist offline kaum verlässlich → bewusst später, nicht in L‑1.

## Datenmodell & Migration

Eine Migration (`migrations/00NN_lage_geo.sql`, Nummer beim Schreiben des Plans festlegen):

```sql
ALTER TABLE uhs            ADD COLUMN lat REAL;
ALTER TABLE uhs            ADD COLUMN lon REAL;
ALTER TABLE einsatz_schaden ADD COLUMN lat REAL;
ALTER TABLE einsatz_schaden ADD COLUMN lon REAL;
```

Nullable, kein Default, kein Mehrspalten-CHECK (folgt dem Einsatzort-Vorbild aus `0005`).
`einsatz` bleibt unverändert (`einsatzort_lat/lon` existiert bereits).

## Backend

- **Verorten = bestehende PATCH-Routen erweitern.** `src/routes/einsatz_uhs.rs` und
  `src/routes/einsatz_schaden.rs` nehmen `lat`/`lon` zusätzlich entgegen. Der Update-Handler
  merged gegen den **Effektivzustand** (Bestandswert), nicht „nur die im Request gesetzten
  Felder" — das ist das gemerkte PATCH-XOR-Muster, das 422 statt 500 liefert; lat/lon werden
  als Paar behandelt. Einsatzort: der bestehende Einsatz-Kopf-PATCH (`aktualisiere_kopf`)
  trägt `einsatzort_lat/lon` schon — Frontend nutzt ihn für den Karten-Picker.
- **Karten-Lesedaten.** Pro verortbarem Typ eine schlanke Liste (id, bezeichnung/registrier_nr,
  status/kategorie, lat, lon), gefiltert auf `storniert_at IS NULL`. Ob das die bestehenden
  Listen-Endpunkte mitliefern (sofern sie die Felder schon tragen) oder ein eigener
  `GET …/karte/objekte`-Aggregat-Endpunkt entsteht, entscheidet der Plan. (Hinweis für später:
  ab vielen heterogenen Typen ist ein Aggregat-Endpunkt/eine View die saubere Antwort — für
  L‑1 mit zwei Typen unkritisch.)
- **Basemap-Auslieferung.** Route, die die konfigurierte PMTiles-Datei mit
  **HTTP-Range-Unterstützung** ausliefert (z. B. `tower-http` `ServeFile`/`ServeDir`, das
  Range-Requests beherrscht). Konfiguration: PMTiles-Pfad + optionale Online-Style-URL über
  CLI/ENV (Muster `src/config.rs`). Fehlt der Pfad → Route liefert 404/leer, Frontend geht in
  den Blind-Modus.
- **Berechtigung/Nachlauf** wie bei allen Einsatz-Sub-Routen über
  `src/einsatz/berechtigung.rs` (lesen = `darf_lesen`, verorten = `ist_schreibberechtigt` +
  `fordere_aktiv`).

## Frontend (Layout A, „modern")

- Neue **`LagekartePage`** unter der Kategorie *Lagekarte* (Modul von `ModulStub` auf aktiv).
  MapLibre GL + `pmtiles`-Protokoll-Registrierung; Vektor-Style passend zum App-Theme
  (hell/dunkel).
- **Layout:** Karte dominant, **linke Sidebar** (einklappbar):
  - Sektion **„⚠ Nicht verortet"** ganz oben mit Anzahl-Badge — die UHS/Schäden ohne
    Koordinate, die noch auf die Karte müssen.
  - darunter verortete Objekte gruppiert nach Typ (UHS, Schäden).
  - Layer-Toggles (Einsatzort/UHS/Schäden ein-/ausblenden), Basemap-Umschalter
    (Online/Offline/Blind).
- **Platzieren:** nicht-verortetes Objekt wählen → Klick auf die Karte setzt `lat/lon`
  (PATCH); alternativ Koordinate manuell eingeben. **Marker-Klick** → kompakter Inspector mit
  Objekt-Info + **Link ins jeweilige Fach-Modul** (UHS-/Schäden-Seite).
- **Marker:** klare SVG-Icons je Typ (Einsatzort / UHS / Schaden); Schaden ggf. nach
  Status/Kategorie eingefärbt. `fly-to` beim Auswählen, dezentes Clustering bei Gedränge.
- **Live:** EventSource auf `sse_uhs`/`sse_schaden` → Marker erscheinen/verschieben/verschwinden
  live.
- **Neue Abhängigkeiten:** `maplibre-gl`, `pmtiles`.

## Bewusst NICHT in L‑1 (Abgrenzung)

- **Fahrzeuge / operativer Standort (FMS), taktische Zeichen DV 102** → **L‑2**.
- **Freies Zeichnen, Gefahren- & Absperrzonen** (Flächen/Linien, entitätsloser Annotations-/
  Skizzen-Layer) → **L‑3**.
- **Live-Fahrzeug-Tracking** → ClickUp-Task (Machbarkeit erst zu prüfen),
  [86ca1nv2v](https://app.clickup.com/t/86ca1nv2v).
- **Geocoding** aus Freitext-Adresse → später.
- **Material** (`standort` = Lager-Freitext, kein operativer Marker) → nicht vorgesehen.

## Tests

- **Backend:** PATCH setzt/ändert/löscht `lat/lon` auf UHS & Schaden (inkl. 422-Pfad des
  Effektivzustand-Merges); Lese-/Kartendaten filtern Stornierte heraus; Basemap-Route liefert
  Range-Requests korrekt aus und degradiert sauber (kein Pfad → 404/leer); Berechtigung
  (lesen/schreiben/Nachlauf).
- **Frontend (Vitest/@testing-library/MSW):** „Nicht verortet"-Liste mit Badge; Platzieren-Flow
  (Objekt wählen → Karten-Klick → PATCH); Marker-Klick → Inspector + Modul-Link;
  Basemap-Umschalten inkl. Blind-Modus.

## Folge-Specs (Lage-Sequenz)

- **L‑2 — Taktische Gliederung:** Einheiten/Abschnitte (K&M‑3) als taktische Zeichen (DV 102)
  auf der Karte; operativer Fahrzeug-/Kräfte-Standort.
- **L‑3 — Gefahren- & Absperrzonen:** freies Zeichnen von Flächen/Linien, entitätsloser
  Annotations-Layer.
- **(L‑4, geparkt):** Live-Fahrzeugpositionen / Tracking — Machbarkeit zuerst (ClickUp).
