# Lagekarte: Bild als Hintergrund (LFH-35)

**Status:** Design freigegeben (Brainstorming abgeschlossen 2026-06-24)
**ClickUp:** LFH-35 (Entwicklungsboard), Parent-Epic Lagekarte
**Typ:** Feature (Frontend + Backend)

## Kontext & Ziel

Der Einsatzleiter soll eigene Bilder (Lageplan, Objektskizze, Gebäudegrundriss,
Kartenausschnitt) als Hintergrund auf die Lagekarte legen können — zusätzlich zu den
bestehenden Basemaps (online/offline/blind). Die Bilder werden pro Einsatz im Backend
gespeichert, bleiben nach Reload erhalten und sind für andere Berechtigte sichtbar.

## Entscheidungen (aus dem Brainstorming)

| Frage | Entscheidung | Begründung |
|---|---|---|
| Integration | **Eigenständige Overlay-Ebenen**, unabhängig vom Basemap-Modus (nicht 4. Basemap-Modus) | User will "mehrere pro Einsatz" + "unabhängig von den Ebenen"; passt technisch zum Fachebenen-Layer-Muster |
| Positionierung | **Interaktiv (Drag) + numerische Eingabe** über dieselben Geo-Ankerpunkte | "beide Modi"; ein Datenmodell, zwei Eingabewege |
| Geometrie | **Gedrehtes Rechteck** (Position + Größe + Drehwinkel), Seitenverhältnis erhalten | Passt zu genordeten/gedrehten Lageplänen, verzerrt das Bild nicht |
| Anzahl | **Mehrere pro Einsatz**, einzeln schalt-/stapelbar | User-Wunsch |
| Opazität | **Pro Bild frei steuerbar** (Slider 0–100 %, Default 100 %) | Blind-Map @100 % = nur Plan; über online/offline runterdrehen zum Abgleich. Ein Regler, keine Auto-Magie (KISS) |
| Speicherung | **BLOB in SQLite** (wie `anhang`-Modul), ein Container | Keine externen Dienste, transaktional konsistent, `VACUUM INTO`-Backup erfasst Bilder mit |
| Koordinaten-Eingabe | **bestehende `KoordinatenEingabe`** wiederverwenden | WGS84/UTM/MGRS/GK schon vorhanden, nichts neu bauen |

### Bewusst draußen (YAGNI)
- Echte GCP-Mehrpunkt-Entzerrung / serverseitiges Bild-Warping (GDAL-artig)
- Frei verzerrbare 4-Ecken-Perspektive (Skew)
- Automatische, basemap-abhängige Opazität

## Architektur

Layer-Reihenfolge auf der Karte (unten → oben):

```
Basemap (online/offline/blind)
  └─ Bild-Overlays (mehrere, je opazität/sichtbar/reihenfolge)
       └─ Abschnitte → Zonen → Fachebenen
            └─ Marker (DOM, immer oben)
```

Damit erfüllt sich das Akzeptanzkriterium „Marker, Zonen, Abschnitte über dem Bild"
strukturell. Die Bild-Overlays liegen über jeder Basemap und sind unabhängig vom
gewählten Basemap-Modus ein-/ausblendbar.

## Backend (neues Submodul `karte_hintergrundbild`)

Vorbild: `lage_zone` (einsatz-scoped Geo-Objekt) + `anhang` (BLOB-Persistenz/Validierung).

### Migration `0075_karte_hintergrundbild.sql`
> Nummer vor dem Merge gegen main verifizieren (Parallel-Worktree-Kollisionsrisiko).

```sql
CREATE TABLE karte_hintergrundbild (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    daten           BLOB    NOT NULL,
    mime            TEXT    NOT NULL,
    groesse         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    ecken_json      TEXT    NOT NULL,            -- Array von genau 4 [lng,lat]-Paaren (MapLibre-Eckreihenfolge)
    opazitaet       INTEGER NOT NULL DEFAULT 100 CHECK (opazitaet BETWEEN 0 AND 100),
    sichtbar        INTEGER NOT NULL DEFAULT 1   CHECK (sichtbar IN (0,1)),
    reihenfolge     INTEGER NOT NULL DEFAULT 0,
    hochgeladen_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_karte_hintergrundbild_einsatz ON karte_hintergrundbild(einsatz_id);
```

### Geometrie-Speicherung
**4 Geo-Eckpunkte** in `ecken_json` (top-left, top-right, bottom-right, bottom-left) —
entspricht MapLibre `image`-Source `coordinates` 1:1. Die Rotation ist in den Ecken
kodiert; das Frontend erzwingt beim Editieren das gedrehte Rechteck mit festem
Seitenverhältnis. (Alternative: parametrisch center+size+rotation — verworfen, weil die
4 Ecken direkt MapLibre-kompatibel sind und keine Umrechnung beim Rendern brauchen.)

### Routen (`src/routes/karte_hintergrundbild.rs`, in `app.rs` registriert)
| Methode | Pfad | Gate | Zweck |
|---|---|---|---|
| `POST`   | `/api/einsaetze/{id}/karte/hintergrundbilder` | schreibrecht + aktiv | Multipart-Upload (Bytes + initiale Ecken), `DefaultBodyLimit` wie `anhang` |
| `GET`    | `/api/einsaetze/{id}/karte/hintergrundbilder` | lesezugriff | Liste der Metadaten (ohne BLOB) |
| `GET`    | `/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}/download` | lesezugriff | Bild-Bytes mit Content-Type |
| `PATCH`  | `/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}` | schreibrecht + aktiv | Ecken / Opazität / Sichtbarkeit / Reihenfolge / Name ändern (ohne Neuupload) |
| `DELETE` | `/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}` | schreibrecht + aktiv | Hard-Delete |

Berechtigungsgates: `fordere_lesezugriff` (lesen), `fordere_schreibrecht` + `fordere_aktiv`
(mutieren) — Muster aus `einsatz_schaden.rs`. Modul-Sichtbarkeit (`fordere_modul_zugriff_laden`)
nur falls das Modul in die Modul-Registry aufgenommen wird (offen, s.u.).

### Upload-Handling („direkt sauber")
- **BLOB in SQLite**, Bytes + Metadaten in *einer* Transaktion (keine verwaisten Daten).
- **Validierung** aus `anhang/mod.rs` wiederverwenden: MIME-Allowlist **nur PNG/JPEG**,
  `MAX_GROESSE`, **Magic-Byte-Sniffing** (nicht dem Client-Content-Type vertrauen),
  SHA256, `scan()`-Seam.
- **Body-Limit** auf der Upload-Route via `DefaultBodyLimit::max(...)` (sonst greift der
  axum-Default von 2 MiB).

### PII-Schwärzung
BLOB bleibt (Kartografie, keine PII). `name` (kann Dateiname mit PII sein) → Platzhalter in
`schwaerze_einsatz()` (`src/einsatz/repo.rs`) ergänzen. `hochgeladen_von` bleibt (Audit).

### Live-Sync
Metadaten-Änderungen (anlegen/patch/delete) über den bestehenden Einsatz-SSE-Stream
propagieren (wie Zonen/Marker), damit andere Berechtigte ohne Reload aktualisiert werden.
Das BLOB selbst wird per `GET …/download` nachgeladen.

## Frontend

### Sidebar-Abschnitt „Bild-Hintergründe" (`pages/lagekarte/Sidebar.tsx`)
Eigener Abschnitt (nicht in der Basemap-Radio-Group):
- Upload-Button (Datei-Auswahl PNG/JPG)
- Liste je Bild: Name, Sichtbar-Toggle, Opazität-Slider, „Platzieren"-Button, Löschen
- Bei mehreren: Reihenfolge (Stapelung) bedienbar

### Overlay-Layer (`pages/lagekarte/`, analog `fachebenenLayer.ts`)
- Pro Bild eine MapLibre `image`-Source + `raster`-Layer (`raster-opacity` aus Opazität).
- Anlage/Re-Anlage in `planeReAnlegenNachStyle()` einbinden (render-Frame-Poller) — deckt
  den bekannten MapLibre-`setStyle`-Gotcha ab (Layer gehen nach Style-Wechsel verloren).
- Layer-Position: vor `abschnitte-fill` (damit unter Abschnitten/Zonen/Markern).

### Platzierungs-Modus
- **Interaktiv:** Drag-Handles auf der Karte — Verschieben, an Ecke skalieren
  (Seitenverhältnis fest), Dreh-Griff. Bild liegt halbtransparent über der aktiven Basemap
  zum Abgleich.
- **Numerisch:** Geo-Ankerpunkte über die bestehende `KoordinatenEingabe`
  (`anzeige/KoordinatenEingabe.tsx`, `value: LatLon`, `onChange`).
- Geometrie-Mathematik: Umrechnung Rechteck (center + breite + höhe + winkel) ↔ 4 Ecken,
  isoliert + unit-getestet.

### API-Client (`api/`)
Neues Modul analog bestehender Einsatz-Submodule: Liste laden, hochladen (multipart),
patchen, löschen, Download-URL bilden.

## Datenfluss

1. Upload: Sidebar → `POST` multipart → Backend validiert + speichert BLOB+Meta in einer Tx
   → SSE „angelegt" → Frontend lädt Liste + Bild-Bytes → Overlay-Layer wird angelegt.
2. Platzieren: Drag/Koordinaten ändern Ecken → `PATCH` → SSE → andere Clients aktualisieren.
3. Reload: `GET` Liste → für jedes sichtbare Bild `GET …/download` → Overlays rekonstruiert.

## Tests (TDD)

**Backend**
- Repo-CRUD (anlegen/laden/liste/patch/delete), BLOB roundtrip, SHA256
- Berechtigungsgates (lesen vs. schreiben, inaktiver Einsatz → 409, fremder Einsatz → 403)
- MIME-/Magic-Byte-Validierung (Reject Nicht-Bild), Größenlimit
- `schwaerze_einsatz()` nullt/ersetzt `name`
- Body-Limit greift

**Frontend**
- Overlay-Layer-Anlage + Re-Anlage nach `setStyle` (render-Frame-Poller)
- Geometrie-Mathematik: Rechteck ↔ 4 Ecken (inkl. Rotation, Seitenverhältnis)
- Sidebar: Upload, Toggle, Opazität, Platzieren, Löschen; mehrere Bilder/Stapelung
- Layer-Reihenfolge (Bild unter Abschnitten/Zonen/Markern)

## Offene Detailpunkte (für die Planung)
- **Modul-Registry / Sichtbarkeits-Override (LFH-132):** eigener Modul-Key
  `karte_hintergrundbild` oder unter bestehendem `karte`-Key? → im Plan klären.
- **Initiale Bounds beim Upload:** Default = aktueller Karten-Viewport (Bild füllt sichtbaren
  Bereich), danach justierbar.
- **Migrationsnummer** final gegen main prüfen.

## Referenzen (Ist-Code)
- Frontend: `pages/LagekartePage.tsx`, `pages/lagekarte/Kartenflaeche.tsx`,
  `pages/lagekarte/basemapStil.ts`, `basemapAuswahl.ts`, `kartenLayer.ts`,
  `fachebenenLayer.ts`, `kartenDaten.ts`, `Sidebar.tsx`, `anzeige/KoordinatenEingabe.tsx`
- Backend: `src/anhang/{mod,repo}.rs`, `src/routes/anhang.rs`, `src/lage_zone/`,
  `src/routes/einsatz_schaden.rs`, `src/einsatz/{berechtigung,repo}.rs`, `src/app.rs`
- Migrationen: `migrations/0036_lage_zone.sql`, `migrations/0052_anhang.sql`
