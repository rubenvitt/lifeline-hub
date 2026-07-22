# Lagekarte: Ansichten & Zeitachse — Design

**Stand:** 2026-07-22 · Betrifft: `frontend/src/pages/lagekarte/*`, `src/routes/karte*.rs`,
`einsatz_einstellungen` (LFH-55/131), `lage_zone` (0036), `karte_hintergrundbild` (0075),
`freies_zeichen` (0085)

## Problem

Die Kartenkonfiguration eines Einsatzes liegt heute an drei Orten, keiner davon dort, wo sie
benutzt wird:

1. **Einstellungsseite** (`EinsatzEinstellungenPage`) — `basemap_modus`, `fachebenen_sichtbar`,
   `karten_zoom_start` als Einsatz-Defaults. Eine Seite, die im laufenden Einsatz niemand öffnet.
2. **localStorage** (`basemapAuswahl.ts`, `fachebenenAuswahl.ts`) — pro Einsatz gemerkte
   Basemap-/Fachebenen-Wahl, browser-lokal, für niemanden sonst sichtbar.
3. **Komponenten-State** (`LagekartePage`, `layer`) — die zehn Layer-Schalter überleben nicht
   einmal einen Reload.

Wer auf der Karte Ebenen einblendet oder von Online auf Offline wechselt, kann das Ergebnis
also **nicht für den Einsatz festhalten**. Und es gibt genau **eine** Karte je Einsatz: kein
Weg, ein zweites, thematisch anderes Lagebild zu führen — und keinen Weg, einen zeitlichen
Stand festzuhalten, weil Verortungen in-place überschrieben werden (keine Positionshistorie).

## Entscheidungen

| Frage | Entscheidung | Begründung |
|---|---|---|
| Was gehört einer Ansicht? | Karten-Objekte (freies Zeichen, Zone, Hintergrundbild) via `ansicht_id`; Einsatz-Entitäten **nie** | Einheit/Fahrzeug/UHS sind einsatzweit deployed und modulübergreifend sichtbar. Eine Ansichts-Mitgliedschaft je Entitätstyp bräuchte Zuordnungstabellen und widerspräche dem Entitätsmodell — pro Ansicht regelt sie der Layer-Schalter |
| `ansicht_id = NULL` | „auf allen Ansichten sichtbar" | Der Bestand migriert auf NULL und bleibt damit unverändert überall sichtbar. Gibt zugleich die fachlich sinnvolle Kategorie „gilt für alle Ansichten" (z. B. Absperrgrenze) |
| Zugehörigkeit 1:n oder n:m | **1:n** (Spalte, keine Join-Tabelle) | Kein Bedarf für „dieselbe Zone auf zwei Ansichten"; NULL deckt den Sonderfall „überall" ab |
| Ansicht geteilt oder persönlich | **Geteilt**, einsatzweit in der DB | Folgt direkt aus „für den Einsatz speichern". Persönliche Ansichten wären ein anderes Feature |
| localStorage | Wird entmachtet auf „zuletzt aktive Ansicht-ID" | Zwei Wahrheiten (Browser vs. geteilte DB-Ansicht) erzeugen genau die Verwirrung, die das Feature beseitigen soll |
| Snapshot-Umfang | **Volles Lagebild**: Geometrie **+** Fachdaten | Ein Stand muss auch dann korrekt bleiben, wenn eine Einheit später umbenannt, umgehängt oder gelöscht wird — sonst ist er als Führungs-/Nachbereitungsdokument wertlos |
| Snapshot-Skopierung | **Einsatzweit**, orthogonal zu Ansichten | Ansicht = räumlich/thematisch, Snapshot = zeitlich. Entitäts-Positionen sind einsatzweit; ein Snapshot je Ansicht würde sie mehrfach einfrieren und hätte keinen gemeinsamen Zeitstand |
| Snapshot-Auslöser | **Nur manuell** („Stand sichern") mit Bezeichnung | Auto-Intervall braucht Ausdünn-Regeln und macht das Replay unruhig; Ereignis-Auslöser sind ein eigenes Regelwerk. Beides additiv nachrüstbar |
| Snapshot-Speicherform | **Ein JSON-Dokument je Snapshot** + `schema_version` | Der Stand wird per Definition nie wieder geschrieben — normalisierte Zeilen brächten Join-Kosten ohne Nutzen. `schema_version` hält alte Stände gegen spätere Feldänderungen lesbar |
| Bilder im Snapshot | Nur ID-Referenz, **kein BLOB-Kopie** | Ein 5-MB-Grundriss je Stand sprengt die DB. Preis: ein später gelöschtes Bild fehlt im Replay (Hinweis statt Bild) — Soft-Delete wäre die saubere, für v1 zu teure Alternative |
| Replay-Schrittweite | Snapshot-zu-Snapshot, **keine Interpolation** | Zwischenpositionen sind nicht erhoben; interpolierte Bewegung wäre erfundene Lage |

## Ticket-Schnitt

Vier Inkremente unter einem Epic; jedes ist für sich lauffähig und liefert Nutzen.

| | Inhalt | Baut auf |
|---|---|---|
| **A** | `karten_ansicht` als Entität, eine automatisch angelegte Standardansicht, „Für den Einsatz speichern" auf der Karte, localStorage-Ablösung | — |
| **B** | Mehrere Ansichten (anlegen/umbenennen/löschen/Standard setzen) + `ansicht_id` an den drei Objekt-Tabellen inkl. Stempel-Pfad beim Anlegen | A |
| **C** | `lage_snapshot`: Erzeugung, Anzeige eines Standes, Schreibsperre im Historien-Modus | A |
| **D** | Replay: Zeitleiste mit Slider und Play/Pause über die Snapshot-Folge | C |

## Architektur

### 1. `karten_ansicht` (Inkrement A)

Hybrid-Speichermodell wie `einsatz_einstellungen` (LFH-55): skalare Spalten für Skalare,
JSON für Mengen. Keine CHECK-Constraints — Validierung in Rust, damit die Tabelle unter dem
sqlx-sqlite-Rebuild-Limit per `ADD COLUMN` erweiterbar bleibt.

```sql
CREATE TABLE karten_ansicht (
    id                  INTEGER PRIMARY KEY,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name                TEXT    NOT NULL,
    reihenfolge         INTEGER NOT NULL DEFAULT 0,
    ist_standard        INTEGER NOT NULL DEFAULT 0,
    basemap_modus       TEXT,           -- 'online' | 'offline' | 'blind'
    online_stil         TEXT,           -- Name aus KarteServerConfig.online_styles
    karten_theme        TEXT,           -- 'auto' | 'light' | 'dark'
    layer_sichtbar      TEXT,           -- JSON, Schlüssel = LayerSichtbar (10 Keys)
    fachebenen_sichtbar TEXT,           -- JSON {"nina","dwd","pegelonline","kritis"}
    zentrum_lat         REAL,
    zentrum_lon         REAL,
    zoom                REAL,
    erstellt_von        INTEGER REFERENCES benutzer(id),
    erstellt_at         TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at        TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_von       INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_karten_ansicht_einsatz ON karten_ansicht(einsatz_id);
CREATE UNIQUE INDEX idx_karten_ansicht_standard
    ON karten_ansicht(einsatz_id) WHERE ist_standard = 1;
```

Der partielle Unique-Index erzwingt **genau eine Standardansicht je Einsatz** auf DB-Ebene und
ist additiv (kein Tabellen-Rebuild). Das Umsetzen des Standards läuft in **einer Transaktion**
(alt auf 0, neu auf 1), sonst schlägt der Index zu.

**Standardansicht-Saat:** Existiert für einen Einsatz keine Ansicht, legt der GET-Handler
lazy eine an — `name = 'Standard'`, gespeist aus `einsatz_einstellungen`
(`basemap_modus`, `fachebenen_sichtbar`, `karten_zoom_start`), Layer alle an. Bestandseinsätze
brauchen so keine Daten-Migration.

**Routen** (`src/routes/karten_ansicht.rs`, EinsatzKontext-gegatet wie `karte.rs`):

```
GET    /api/einsaetze/{id}/karten-ansichten            → Liste (legt lazy die Standardansicht an)
POST   /api/einsaetze/{id}/karten-ansichten            → anlegen
PATCH  /api/einsaetze/{id}/karten-ansichten/{aid}      → Konfiguration/Name/Standard
DELETE /api/einsaetze/{id}/karten-ansichten/{aid}?objekte=freigeben|loeschen
```

Schreibrecht: `darfImEinsatzSchreiben` für alles, inkl. „Standard setzen" — konsistent damit,
dass jeder Schreibberechtigte Zonen und Zeichen anlegen darf.

### 2. Objekt-Zugehörigkeit (Inkrement B)

Je eine additive Migration auf `freies_zeichen`, `lage_zone`, `karte_hintergrundbild`:

```sql
ALTER TABLE <tabelle> ADD COLUMN ansicht_id INTEGER
    REFERENCES karten_ansicht(id) ON DELETE SET NULL;
```

SQLite erlaubt `REFERENCES` beim `ADD COLUMN`, solange der Default NULL ist — also kein
CHECK-Rebuild, keine `include_str!`-Prozedur. `NULL` = auf allen Ansichten sichtbar; der
Bestand landet automatisch dort.

- **Schreibpfad:** Die POST-Handler der drei Objekte nehmen `ansicht_id` entgegen; das Frontend
  sendet die aktive Ansicht. Das ist die Membership-Schreibstelle — ohne sie ist das Feature
  wirkungslos.
- **Lesepfad:** Die Listen-Handler filtern `WHERE ansicht_id IS NULL OR ansicht_id = ?`,
  Parameter aus dem Query-Param `ansicht`. Ohne Parameter (z. B. andere Module, Export)
  bleibt das Verhalten wie heute: alles.
- **Inspector:** Schalter „auf allen Ansichten zeigen" → `ansicht_id = NULL`; sonst Auswahl der
  Ziel-Ansicht (verschieben).
- **Ansicht löschen:** `?objekte=freigeben` (Default, → NULL) oder `?objekte=loeschen`. Die
  Standardansicht und die letzte verbleibende Ansicht sind nicht löschbar → 422.

### 3. Frontend-Anbindung (Inkrement A/B)

Neuer Hook `useKartenAnsicht({ einsatzId })` neben `useBasemap`/`useFachebenen`:

- lädt die Ansichten, kennt die aktive über den Query-Param `?ansicht=<id>` (Deeplink-Muster:
  Query-Param, weil die Ansicht keine eigene Detailroute hat — `deeplinks.ts` bekommt den
  Builder),
- speist Basemap-, Fachebenen- und Layer-State initial aus der Ansicht,
- hält den Vergleich „aktueller Zustand ≠ gespeicherte Ansicht" (schmutzig) und stellt daraus
  die Aktionen **„Für den Einsatz speichern"** (überschreibt) und **„Als neue Ansicht
  speichern"** bereit.

`useBasemap` und `useFachebenen` verlieren ihre localStorage-Initialisierung und bekommen ihre
Startwerte vom neuen Hook; die zwei `*Auswahl.ts`-Module schrumpfen auf einen Schlüssel
`lfh:lagekarte:<einsatzId>:ansicht` (zuletzt aktive Ansicht). Der Layer-State zieht aus
`LagekartePage` in den Hook.

Die Sidebar bekommt oben den **Ansichts-Switcher** (Select + Neu/Umbenennen/Löschen), passend
zum kompakten Navigationsmuster der App.

### 4. `lage_snapshot` (Inkrement C)

```sql
CREATE TABLE lage_snapshot (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung    TEXT,
    notiz          TEXT,
    stand_at       TEXT    NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    daten          TEXT    NOT NULL,
    erstellt_von   INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lage_snapshot_einsatz ON lage_snapshot(einsatz_id, stand_at);
```

Dokument-Form (`schema_version = 1`):

```json
{
  "version": 1,
  "stand_at": "2026-07-22T08:00:00Z",
  "ansichten": [{ "id": 1, "name": "Standard", "...": "Konfiguration wie in karten_ansicht" }],
  "marker": [{
    "typ": "fahrzeug", "id": 42, "lat": 51.1, "lon": 7.2,
    "label": "…", "status": "…", "staerke": "…", "abschnitt_id": 3,
    "taktisches_zeichen": { "…": "Overlays" }
  }],
  "zonen": [{ "id": 7, "typ": "…", "geometrie": {}, "label": "…", "ansicht_id": null }],
  "freie_zeichen": [{ "id": 3, "lat": 51.1, "lon": 7.2, "…": "TZ-Felder", "ansicht_id": 1 }],
  "bilder": [{ "id": 2, "name": "Grundriss", "ecken": [], "opazitaet": 80, "ansicht_id": 1 }]
}
```

**Unveränderlichkeit:** `POST`, `GET` (Liste + Einzeldokument), `DELETE`. Ein `PATCH` existiert
nur für `bezeichnung`/`notiz`; `daten`, `stand_at` und `erstellt_*` sind nicht schreibbar.
Löschen ist Dokumenten-Vernichtung → `darfEinsatzLeiten`; Anlegen → `darfImEinsatzSchreiben`.

Das Einsammeln läuft serverseitig in **einer Transaktion** über dieselben Repo-Funktionen, die
die Lagekarte speisen — ein Stand darf keinen halben Schreibvorgang einfangen.

Größenordnung: ~300 Marker ≈ 100 KB je Snapshot; 50 Stände ≈ 5 MB. Unkritisch für SQLite,
aber `daten` gehört nicht in Listen-Responses (Liste liefert nur Metadaten).

### 5. Historien-Modus und Replay (Inkrement C/D)

`useLagekarteDaten` bekommt eine austauschbare Quelle:

```ts
type Standquelle = { typ: 'live' } | { typ: 'snapshot'; id: number };
```

Beide Zweige liefern dieselbe Datenform (Marker/Zonen/Zeichen/Bilder), sodass
`Kartenflaeche`, `marker.ts`, `markerLayer.ts` und `zonenStil.ts` unverändert bleiben. Das ist
die einzige größere Umbaustelle im Frontend und der Grund, warum C ein eigenes Inkrement ist.

- **Banner** „Historischer Stand — schreibgeschützt" mit Rücksprung auf „Aktuell".
- **Schreibsperre:** `darfSchreiben` wird im Historien-Modus hart auf `false` gefahren; damit
  fallen Platzieren, Zeichnen, Inspector-Edit und die Sidebar-Aktionen ohne Einzelfall-Logik weg.
- **Ansichts-Switcher bleibt aktiv** — Ansicht (Brille) und Snapshot (Zeitpunkt) sind orthogonal.
- **D:** Zeitleiste als Band unterhalb der Karte, Slider über die Snapshot-Folge plus
  Play/Pause mit fester Anzeigedauer je Stand. Vorladen des jeweils nächsten Dokuments,
  damit der Schritt nicht flackert.

## Anschlüsse an bestehende Verträge

- **SSE:** zwei neue `LiveEvent`-Varianten `KartenAnsicht` und `LageSnapshot` inkl.
  `modul_keys()`-Eintrag (Modul `lagekarte`), `ALLE`-Array, `tests/enum_wire_kontrakt.rs` und
  der FE-Invalidierungsmap in `api/queryKeys.ts`. Ohne das bricht der Cross-Language-Kontrakt.
- **Typ-Codegen:** neue Response-DTOs brauchen `#[derive(ToSchema)]` + Eintrag in `api_doc.rs`;
  `scripts/check-typ-codegen.sh` laufen lassen und `openapi.json` + `types.generated.ts`
  mitcommitten. Enum-tragende `String`-Felder (`basemap_modus`, `karten_theme`) bekommen
  `#[schema(value_type = Option<Enum>)]`.
- **Extractor:** Bodies ausschließlich über `crate::extract::JsonBody`
  (`tests/json_extractor_guard.rs`).
- **Statuscodes:** leerer Name → 400; unbekannter `basemap_modus`/`karten_theme` → 400;
  Standard- oder letzte Ansicht löschen → 422; Snapshot/Ansicht eines fremden Einsatzes → 404
  über den EinsatzKontext-Extractor.
- **Einstellungsseite:** die drei Karten-Default-Felder verschwinden aus dem Formular und
  leben künftig auf der Karte. Die Spalten bleiben als Saat der Standardansicht. **Achtung:**
  `einstellungen::speichern` ist ein Vollersatz-UPSERT — entfernte Formularfelder müssen
  weiterhin mit ihrem Bestandswert im Payload mitfahren, sonst löscht der nächste Save sie.
- **DSGVO:** `lage_snapshot.daten` enthält Fachdaten inkl. möglicher PII (Personal-Marker,
  Labels). Die Tabelle gehört in `schwaerze_einsatz` (LFH-135) — sonst überlebt PII die
  Schwärzung im Snapshot-Dokument.

## Testplan

| Ebene | Fall |
|---|---|
| Rust | Standardansicht wird lazy angelegt und aus `einsatz_einstellungen` gespeist |
| Rust | Zweite Ansicht auf `ist_standard` setzen → alte verliert das Flag (eine Transaktion, Index hält) |
| Rust | Standardansicht bzw. letzte Ansicht löschen → 422 |
| Rust | Ansicht löschen mit `objekte=freigeben` → Objekte auf NULL; mit `loeschen` → weg |
| Rust | Objekt-Liste mit `?ansicht=X` liefert X-Objekte **und** NULL-Objekte, nicht die von Y |
| Rust | Snapshot-Dokument enthält Fachdaten; späteres Umbenennen der Einheit ändert den Stand nicht |
| Rust | `PATCH` auf `daten`/`stand_at` existiert nicht (Feldliste im Guard) |
| Rust | Cross-Org/Fremdeinsatz → 404 |
| Vitest | Schmutzig-Erkennung: Basemap-Wechsel blendet „Für den Einsatz speichern" ein |
| Vitest | Ansichtswechsel setzt Layer-/Fachebenen-State neu und schreibt `?ansicht=` |
| Vitest | Historien-Modus sperrt Schreibaktionen (`darfSchreiben = false`) |
| e2e | Ansicht speichern → Reload → Konfiguration steht (statt localStorage-Wahrheit) |

## Bewusst nicht in v1

- Persönliche (nur für mich sichtbare) Ansichten.
- Automatische Snapshots (Intervall oder Lage-Ereignis).
- Interpolierte Bewegung zwischen zwei Ständen.
- Soft-Delete für Hintergrundbilder, die in Snapshots referenziert sind — ein gelöschtes Bild
  erscheint im Replay als Hinweis statt als Overlay.
- Snapshot-Vergleich („was hat sich zwischen 08:00 und 10:00 geändert").
- Export eines Standes als PDF/Bild.
