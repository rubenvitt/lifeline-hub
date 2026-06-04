# Gefahren-Verwaltung nach Gefahrenschema (LFH-53)

> Teilprojekt zur Lage. Vorbild für das Fachschema ist `../bluelight-hub`
> (Gefahrenmatrix). Vorbild für die Backend-/Frontend-Konventionen ist das bereits
> umgesetzte L‑3 (`src/lage_zone/`, `src/einsatzabschnitt/`).

## Worum es geht

Heute ist das Modul `gefahrenzonen` ein reiner Deep-Link auf die Lagekarte
(`verweistAuf: 'lagekarte'`) — Gefahren-/Absperrzonen werden dort als `lage_zone`
gezeichnet, aber **nicht fachlich bewertet**. Es fehlt das eigentliche „Gefahrenschema":
die strukturierte Einschätzung, welche Gefahr welches Schutzobjekt wie stark bedroht.

Wir bauen das Gefahrenschema aus bluelight-hub nach (Konzept, nicht Code — lifeline-hub ist
Rust + SQLite, nicht NestJS/Prisma): eine **Gefahrenmatrix** als bewertbares Aggregat und
eine **optionale Verknüpfung** der `gefahrengebiet`-Zonen mit Matrix-Zellen. Der Deep-Link
wird zu einer **echten Verwaltungsseite** (Variante C der Klärungs-Task LFH-53).

**Grundsatz: additiv, kein Rewrite.** Das bestehende Zonen-Zeichnen auf der Lagekarte
bleibt unverändert funktionsfähig. Wir ergänzen die Bewertungsebene und eine optionale
Brücke zwischen Zone und Matrix.

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

- **Volle Matrix + Zonen-Verknüpfung** (mit dem User abgestimmt): Matrix als eigene Seite
  *und* `gefahrengebiet`-Zonen verweisen optional auf Matrix-Zellen.
- **Nur `gefahrengebiet`-Zonen** tragen die Gefahren-Zuordnung. `absperrbereich`,
  `absperrgrenze`, `sperrgebiet`, `freie_skizze` bleiben reine Annotationen.
- **Modul-Auflösung:** `gefahrenzonen`-Eintrag wird eine echte Seite — `verweistAuf`
  entfällt, Route `gefahren`, Label „Gefahren". Bleibt in Kategorie `lage`.
- **Enum-Werte als lowercase-snake-Strings** (Hauskonvention wie `lage_zone.typ`), nicht
  UPPER_CASE wie in BLH.
- **ETB-Spur:** *jede* Warnstufen-Änderung erzeugt einen ETB-Eintrag (abgestimmt).
- **Fachliche Bindung erzwingt die App, nicht die DB** (wie bei `lage_zone`): keine
  Mehrspalten-CHECKs, keine DB-Composite-FK. Siehe Memory `patch-xor-effektivzustand`.
- **Live über den bestehenden `useEinsatzLiveStream`** — kein zweiter EventSource (Memory
  `sse-eine-verbindung-pro-einsatz`). Backend ergänzt einen `LiveHub`-Kanal `gefahr`.
- **Frontend ins Binary eingebettet:** Änderungen brauchen `pnpm build` + Backend-Neustart
  (Memory `frontend-in-binary-eingebettet`).

## Gefahrenschema (verbatim aus bluelight-hub)

**13 Gefahrentypen** (`gefahrentyp`):
`atemgifte, angstreaktion, ausbreitung, atomare_strahlung, chemische_stoffe,
erkrankung_verletzung, explosion, elektrizitaet, einsturz, absturz, brand, durchbruch,
ertrinken`

**5 Schutzobjekte** (`schutzobjekt`):
`menschen, tiere, umwelt, sachwerte, einsatzkraefte`

**5 Warnstufen** (`warnstufe`):
`keine, niedrig, mittel, hoch, akut` (Default `keine` = effektiv keine Bewertung)

**Ungültige Kombinationen** (`kombination_gueltig(typ, objekt) -> bool`, verbatim aus BLH):
- `sachwerte` × {`angstreaktion`, `atemgifte`, `erkrankung_verletzung`, `ertrinken`}
- `umwelt` × {`angstreaktion`, `erkrankung_verletzung`, `ertrinken`}

Ungültige Kombination beim Schreiben → `AppError::UnprocessableEntity` (422). Im Grid sind
diese Zellen ausgegraut/nicht editierbar.

Labels (Anzeige) werden im Backend-Modul und im Frontend-Schema gepflegt; eine Wahrheit je
Schicht (Backend liefert sie nicht über die API mit — das Frontend kennt die Kataloge
statisch, wie BLH).

## Datenmodell & Migrationen

### Migration 0037 — Tabelle `gefahr_bewertung` (Matrix-Zelle)

```sql
-- Gefahrenmatrix-Bewertung: pro Einsatz max. 1 Bewertung je (gefahrentyp, schutzobjekt).
-- Warnstufe ist die Wahrheit; Zonen referenzieren diese Zelle (App-seitig, kein DB-FK).
-- CHECKs je Spalte einzeln; die Kombinations-Gültigkeit erzwingt die App.
-- Hard-Delete via ON DELETE CASCADE beim Einsatz-Löschen; Historie lebt im ETB.
CREATE TABLE gefahr_bewertung (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    gefahrentyp      TEXT NOT NULL
                       CHECK (gefahrentyp IN ('atemgifte','angstreaktion','ausbreitung',
                         'atomare_strahlung','chemische_stoffe','erkrankung_verletzung',
                         'explosion','elektrizitaet','einsturz','absturz','brand',
                         'durchbruch','ertrinken')),
    schutzobjekt     TEXT NOT NULL
                       CHECK (schutzobjekt IN ('menschen','tiere','umwelt','sachwerte',
                         'einsatzkraefte')),
    warnstufe        TEXT NOT NULL DEFAULT 'keine'
                       CHECK (warnstufe IN ('keine','niedrig','mittel','hoch','akut')),
    beschreibung     TEXT,
    gemeldet_von     TEXT,
    aktualisiert_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at      TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, gefahrentyp, schutzobjekt)
);
CREATE INDEX idx_gefahr_bewertung_einsatz ON gefahr_bewertung(einsatz_id);
```

### Migration 0038 — `lage_zone` um optionale Gefahren-Zuordnung erweitern

```sql
-- Optionale Verknüpfung einer gefahrengebiet-Zone auf eine Matrix-Zelle.
-- Beide Spalten nullable; gültig nur gemeinsam und nur für typ='gefahrengebiet'.
-- Validierung (beide-oder-keine, gültige Enums/Kombination, nur gefahrengebiet)
-- und Lazy-Create der Zelle erzwingt die App, nicht die DB.
ALTER TABLE lage_zone ADD COLUMN gefahrentyp  TEXT;
ALTER TABLE lage_zone ADD COLUMN schutzobjekt TEXT;
```

**Lazy-Create (analog BLH ADR-010):** Verknüpft eine Zone auf eine `(gefahrentyp,
schutzobjekt)`-Zelle, die für den Einsatz noch nicht existiert, legt das Repo sie mit
`warnstufe='keine'` an, bevor die Zone gespeichert wird. Eine Zone darf auch *ohne*
Verknüpfung existieren (beide Felder NULL).

## Backend — Modul `src/gefahr/` (analog `einsatzabschnitt`/`lage_zone`)

**Neu:**
- `src/gefahr/mod.rs` — `GefahrBewertungAnzeige` (Serialize-DTO), Enum-Kataloge
  (`GEFAHRENTYPEN`, `SCHUTZOBJEKTE`, `WARNSTUFEN`), `*_label`-Helfer,
  `kombination_gueltig(typ, objekt)`.
- `src/gefahr/repo.rs` — `liste(einsatz_id)` (alle gesetzten Zellen), `upsert_bewertung`
  (UPSERT auf `UNIQUE`; `warnstufe='keine'` = Zelle effektiv leeren/löschen),
  `lazy_create_zelle(einsatz_id, typ, objekt, benutzer_id)` (für die Zonen-Verknüpfung;
  `benutzer_id` = handelnder Benutzer als `aktualisiert_von`, `warnstufe='keine'`) + Unit-Tests.
- `src/routes/gefahr.rs` — Handler:
  - `GET  /einsaetze/:id/gefahrenmatrix` — Liste der gesetzten Zellen (Frontend rendert das
    13×5-Raster aus den Katalogen, füllt mit den gelieferten Zellen)
  - `PUT  /einsaetze/:id/gefahrenmatrix/bewertung` — Body `{gefahrentyp, schutzobjekt,
    warnstufe, beschreibung?, gemeldet_von?}`; validiert Enums + `kombination_gueltig`;
    ETB-Append bei Warnstufen-Änderung; live als `gefahr`-Event
  - `GET  /einsaetze/:id/gefahrenmatrix/stream` — SSE-Stream (analog
    `routes/einsatzabschnitt.rs`)
- `tests/gefahr.rs` — Integrationstests (s.u.).

**Geändert:**
- `src/lib.rs` / `src/routes/mod.rs` / `src/app.rs` — Modul + 3 Routen einhängen.
- `src/lage_zone/mod.rs` — `LageZoneAnzeige` um `gefahrentyp: Option<String>`,
  `schutzobjekt: Option<String>` erweitern; Validierungs-Helfer
  `gefahren_zuordnung_gueltig(typ_der_zone, gefahrentyp, schutzobjekt)` (nur
  `gefahrengebiet`, beide-oder-keine, gültige Enums + `gefahr::kombination_gueltig`).
- `src/lage_zone/repo.rs` — `anlegen`/`aktualisiere` nehmen die zwei optionalen Felder;
  beim Setzen → `gefahr::repo::lazy_create_zelle`. Partial-PATCH via `CASE WHEN` (Memory
  `patch-xor-effektivzustand`: Merge gegen Effektivzustand).
- `src/routes/lage_zone.rs` — POST/PATCH akzeptieren die optionalen Felder (Tri-State-
  Deserializer für nullable wie gehabt), validieren, reichen ans Repo durch.

### ETB-Integration

Bei `PUT .../bewertung`, wenn sich `warnstufe` real ändert (auch `keine` → x und x →
`keine`): ETB-System-Eintrag via `etb_system(...)` (Vorbild
`routes/einsatzabschnitt.rs`), Wortlaut im `«…»`-Format, z. B.:
`Gefahr «Brand» für «Menschen» auf Warnstufe «hoch» gesetzt.` Reine Beschreibungs-/
`gemeldet_von`-Änderungen ohne Warnstufen-Wechsel erzeugen **keinen** ETB-Eintrag.

### Berechtigung

In jedem Handler wie im Vorbild: GET/stream → `fordere_lesezugriff`; PUT →
`fordere_schreibrecht` + `fordere_aktiv`. Org-Isolation wie überall.

### Live (Kanal `gefahr`)

Neuer `LiveHub`-Kanal `gefahr` über die bestehende Infrastruktur. Frontend hängt ihn an den
bestehenden `useEinsatzLiveStream` (kein zweiter EventSource). Zonen-Verknüpfung publiziert
weiter über den vorhandenen `lage_zone`-Kanal; ändert die Verknüpfung eine Warnstufe (Lazy-
Create), kommt zusätzlich ein `gefahr`-Event.

## Frontend

**Neue Seite** (Vorbild bestehender Modul-Seiten unter `frontend/src/pages/`):
- `frontend/src/pages/gefahren/GefahrenPage.tsx` — 13×5-Grid (Gefahrentyp-Zeilen ×
  Schutzobjekt-Spalten), Warnstufen-Dropdown je Zelle, Farbcodierung nach Warnstufe,
  Beschreibung/`gemeldet_von` editierbar (Detail-Panel/Popover), Zonen-Count-Badge je Zelle
  mit Deep-Link auf die Lagekarte. Ungültige Kombinationen ausgegraut.
- `frontend/src/pages/gefahren/gefahrenSchema.ts` — Kataloge + Labels + `kombinationGueltig`
  + Warnstufen-Farben (eine Wahrheit, mit Unit-Test).
- `frontend/src/api/gefahren.ts` — API-Client (`ladeGefahrenmatrix`, `setzeBewertung`).

**Geändert:**
- `frontend/src/einsatz/modulRegistry.ts` — `gefahrenzonen`-Eintrag: `verweistAuf` raus,
  `route: 'gefahren'`, `label: 'Gefahren'`, `status: 'fertig'`, Beschreibung anpassen.
- `frontend/src/api/types.ts` — `GefahrBewertung`, `Warnstufe`, `Gefahrentyp`,
  `Schutzobjekt`; `LageZone` um die zwei optionalen Felder.
- Routing/Seiten-Registrierung der neuen `gefahren`-Route.
- `useEinsatzLiveStream` / Query-Invalidierung — `gefahr`-Event invalidiert die Matrix-Query.
- Lagekarte-`ZonenInspector` — bei `typ='gefahrengebiet'` optionale Auswahl Gefahrentyp +
  Schutzobjekt; warnstufenabgeleitetes Styling/Badge der Zone (Warnstufe aus der Matrix).

## Tests

**Backend (`tests/gefahr.rs`, Vorbild `tests/lage_zone.rs`):**
- Matrix leer → leere Liste; `PUT` legt Zelle an; erneutes `PUT` aktualisiert (UPSERT).
- `warnstufe='keine'` leert die Zelle (kein Phantom-Eintrag).
- Ungültiger Enum-Wert → 422; ungültige Kombination (`sachwerte`×`atemgifte`) → 422.
- ETB-Eintrag bei Warnstufen-Wechsel; **kein** ETB bei reiner Beschreibungs-Änderung.
- SSE: `PUT` löst `gefahr`-Event aus.
- Berechtigung (Lesezugriff/Schreibrecht/aktiv) + Org-Isolation.

**Backend `lage_zone` (Erweiterung in `tests/lage_zone.rs`):**
- `gefahrengebiet`-Zone mit gültiger Zuordnung → Lazy-Create der Zelle (`warnstufe='keine'`).
- Zuordnung an Nicht-`gefahrengebiet`-Zone → 422; nur eines der beiden Felder → 422.
- PATCH entfernt Zuordnung (beide → NULL) ohne die Matrix-Zelle zu löschen.

**Frontend (Vitest, Vorbild bestehender Seiten-Tests; volle Suite via
`--no-file-parallelism`, Memory `frontend-testsuite-parallel-timeouts`):**
- `gefahrenSchema.test.ts` — `kombinationGueltig` deckt die ungültigen Paare ab.
- `GefahrenPage.test.tsx` — Raster rendert 13×5; Warnstufe setzen ruft API; ungültige Zellen
  disabled; Badge zeigt Zonen-Anzahl; Live-Event invalidiert.

## Bewusst NICHT in diesem Teilprojekt (Abgrenzung)

- **Gefährdungsbeurteilung/Eigenschutz** (BLH `Gefaehrdungsbeurteilung`) — späteres
  Teilprojekt.
- **Circle-Geometrie** für Zonen — lifeline nutzt Polygon/LineString; bleibt so.
- **Kein DB-Composite-FK** Zone→Zelle — App-seitige Bindung (Hauskonvention).
- Keine Migration bestehender Zonen (es gibt keine Gefahren-Zuordnung zu migrieren).

## Phasen (für den Implementierungsplan)

1. **Backend Matrix** — Migration 0037, `src/gefahr/`, Routen, ETB, SSE-Kanal,
   `tests/gefahr.rs`. Gate: `cargo test`.
2. **Frontend Matrix-Seite** — `GefahrenPage`, Schema, API-Client, Registry-Umbau,
   Live-Invalidierung. Gate: Vitest (`--no-file-parallelism`) + `pnpm build`.
3. **Zonen-Verknüpfung** — Migration 0038, `lage_zone`-Felder + Validierung + Lazy-Create,
   Karten-`ZonenInspector`, warnstufenabgeleitetes Styling. Gate: Integration (`cargo test`
   + Vitest).

Jede Phase mit TDD (Vorbild-Tests vorhanden).
