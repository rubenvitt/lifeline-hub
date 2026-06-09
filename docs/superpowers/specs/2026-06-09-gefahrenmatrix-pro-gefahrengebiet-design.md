# Gefahrenmatrix pro Gefahrengebiet (geografisch) — LFH-70

> Baut auf LFH-53 auf (Gefahren-Verwaltung nach Gefahrenschema, shipped).
> Vorbild für Backend-/Frontend-Konventionen: `src/lage_zone/`, `src/einsatzabschnitt/`.
> Spec LFH-53: `docs/superpowers/specs/2026-06-04-lage-gefahren-verwaltung-design.md`.

## Worum es geht

LFH-53 hat die Gefahren-Verwaltung als **einsatzweite** Gefahrenmatrix gebaut: pro Einsatz
genau eine Matrix (`gefahr_bewertung`, UNIQUE über `einsatz_id, gefahrentyp,
schutzobjekt`). `gefahrengebiet`-Zonen der Lagekarte konnten optional per Einzelzeiger
(`lage_zone.gefahrentyp/schutzobjekt`) auf **eine** Matrix-Zelle verweisen — teilten sich
aber alle dieselbe globale Matrix.

Im Einsatzgeschehen ist die Gefährdungslage örtlich unterschiedlich: jedes gezeichnete
Gefahrengebiet hat seine eigene Gefährdung. Eine einzige einsatzweite Matrix bildet das
nicht ab.

**Gewünscht (mit User abgestimmt — Fokus Lagekarte, nicht Einsatzabschnitte):** Ein
Gefahrengebiet auf der Lagekarte zeichnen und für genau dieses Gebiet seine Warnstufen über
eine volle 13×5-Matrix definieren. Also **eine Gefahrenmatrix je geografischem Bereich**
statt einer globalen. Mehrere gezeichnete Gebiete lassen sich zu einem **zusammenlegen**, das
dann eine gemeinsame Matrix trägt.

## Gesetzte Entscheidungen (in diesem Brainstorming abgestimmt, nicht neu verhandeln)

1. **Bestandsdaten faktisch leer** — LFH-53 hat keine produktiv erhaltenswerten Daten.
   Migration darf die einsatzweite Matrix schlicht verwerfen/neu aufbauen (Drop/Rebuild).
2. **Gruppen-Modell** — Die Matrix hängt an einem **Gefahrengebiet** (Gruppe aus 1..n
   gezeichneten Zonen), nicht an der Zone und nicht am Einsatz. „Zusammenlegen" = Zonen
   demselben Gefahrengebiet zuordnen (reversibel, nicht-destruktiv). **Keine** Geometrie-Union.
3. **Globale einsatzweite Matrix entfällt** — keine „gebietslose" Matrix mehr; alles ist
   pro Gefahrengebiet.
4. **Einzelzeiger aus LFH-53 entfällt** — `lage_zone.gefahrentyp/schutzobjekt` (Migration
   0040) und der `lazy_create_zelle`-Pfad werden abgelöst. Die volle Matrix pro Gruppe
   ersetzt den Einzelzeiger.
5. **Auto-Gruppe** — Jede gezeichnete `gefahrengebiet`-Zone bekommt beim Anlegen automatisch
   ein Gefahrengebiet (Gruppe-von-eins).
6. **GefahrenPage = Übersicht aller Gebiete** — Liste/Auswahl der Gefahrengebiete des
   Einsatzes, je gewähltem Gebiet die 13×5-Matrix. Kartenlose Lage-Sicht bleibt erhalten;
   der Karten-Inspector öffnet dieselbe Matrix kontextuell.
7. **Merge-UX = Inspector-Zuordnung** — Im Zonen-Inspector ein Feld „Gehört zu
   Gefahrengebiet: [Dropdown bestehender Gruppen | + neues]". Keine Mehrfachselektion auf
   der Karte.
8. **Merge-Konflikt = Zone adoptiert Ziel-Matrix** — Eine umgehängte Zone übernimmt schlicht
   die Matrix der Zielgruppe. Wird die Quellgruppe dabei leer, wird sie (mit ihrer Matrix)
   aufgeräumt. UI warnt, falls die umzuhängende Gruppe bereits Warnstufen hatte.

Weiter übernommen aus LFH-53 (Hauskonventionen):
- **Enum-Werte als lowercase-snake-Strings**, fachliche Bindung erzwingt die App, nicht die
  DB (keine Mehrspalten-CHECKs, kein DB-Composite-FK Zone→Zelle). Memory
  `patch-xor-effektivzustand`.
- **Live über den bestehenden `useEinsatzLiveStream`** — kein zweiter EventSource (Memory
  `sse-eine-verbindung-pro-einsatz`).
- **Frontend ins Binary eingebettet** — Änderungen brauchen `pnpm build` + Backend-Neustart
  (Memory `frontend-in-binary-eingebettet`).

## Gefahrenschema (unverändert aus LFH-53)

- **13 Gefahrentypen** (`gefahrentyp`): `atemgifte, angstreaktion, ausbreitung,
  atomare_strahlung, chemische_stoffe, erkrankung_verletzung, explosion, elektrizitaet,
  einsturz, absturz, brand, durchbruch, ertrinken`
- **5 Schutzobjekte** (`schutzobjekt`): `menschen, tiere, umwelt, sachwerte, einsatzkraefte`
- **5 Warnstufen** (`warnstufe`): `keine, niedrig, mittel, hoch, akut` (Default `keine`)
- **Ungültige Kombinationen** (`kombination_gueltig`, verbatim):
  - `sachwerte` × {`angstreaktion`, `atemgifte`, `erkrankung_verletzung`, `ertrinken`}
  - `umwelt` × {`angstreaktion`, `erkrankung_verletzung`, `ertrinken`}
  - Schreiben einer ungültigen Kombination → 422. Im Grid ausgegraut.

## Terminologie

- **Gefahrengebiet** = die *bewertete Fläche*, trägt **eine** 13×5-Matrix (neue Tabelle
  `gefahrengebiet`). Besteht aus 1..n Zonen.
- **Zone** = der gezeichnete Polygon (`lage_zone` typ=`gefahrengebiet`).
- **Zusammenlegen** = Zonen demselben Gefahrengebiet zuordnen.

## Datenmodell & Migration 0041

Daten faktisch leer → Drop/Rebuild ist unkritisch. SQLite kann UNIQUE-Constraints nicht per
`ALTER` ändern; deshalb wird `gefahr_bewertung` neu erstellt (kein Datenerhalt nötig).

```sql
-- Migration 0041_gefahrengebiet.sql

-- Gefahrengebiet: bewertete Fläche, trägt eine Matrix; Gruppe aus 1..n Zonen.
CREATE TABLE gefahrengebiet (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    label        TEXT,
    erstellt_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at  TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gefahrengebiet_einsatz ON gefahrengebiet(einsatz_id);

-- gefahr_bewertung neu: Matrix-Zelle hängt am Gefahrengebiet (nicht am Einsatz).
DROP TABLE gefahr_bewertung;
CREATE TABLE gefahr_bewertung (
    id               INTEGER PRIMARY KEY,
    gefahrengebiet_id INTEGER NOT NULL REFERENCES gefahrengebiet(id) ON DELETE CASCADE,
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
    UNIQUE (gefahrengebiet_id, gefahrentyp, schutzobjekt)
);
CREATE INDEX idx_gefahr_bewertung_gebiet ON gefahr_bewertung(gefahrengebiet_id);

-- lage_zone: Einzelzeiger raus, Gruppen-Zugehörigkeit rein.
ALTER TABLE lage_zone DROP COLUMN gefahrentyp;
ALTER TABLE lage_zone DROP COLUMN schutzobjekt;
ALTER TABLE lage_zone ADD COLUMN gefahrengebiet_id INTEGER
    REFERENCES gefahrengebiet(id) ON DELETE SET NULL;
CREATE INDEX idx_lage_zone_gebiet ON lage_zone(gefahrengebiet_id);
```

**`lage_zone.gefahrengebiet_id`**: nur bei `typ='gefahrengebiet'` gesetzt, sonst NULL.
`ON DELETE SET NULL` ist eine Absicherung; im Normalfall löscht die App ein Gefahrengebiet
erst, wenn es keine Zone mehr hat (s. Lebenszyklus).

### Lebenszyklus (App-geführt)

- `gefahrengebiet`-Zone zeichnen → automatisch neues Gefahrengebiet (Gruppe-von-eins),
  `label` aus Zonen-`label` oder „Gefahrengebiet N".
- Zone einem anderen Gefahrengebiet zuordnen (Merge) → `gefahrengebiet_id` umhängen; Zone
  adoptiert die Ziel-Matrix.
- Wird eine Quellgruppe durch Umhängen/Löschen/Typwechsel leer → Gefahrengebiet wird
  entfernt (Matrix cascaded mit weg).
- Zone-Typ wechselt weg von `gefahrengebiet` → Mitgliedschaft gelöst, ggf. leere Gruppe
  aufräumen.

## Backend

### `src/gefahr/` (Matrix-Modul, umgestellt)

- `mod.rs` — Kataloge (`GEFAHRENTYPEN`, `SCHUTZOBJEKTE`, `WARNSTUFEN`), `*_label`,
  `kombination_gueltig` **bleiben**. `GefahrBewertungAnzeige.einsatz_id` →
  `gefahrengebiet_id`. Neu: `GefahrengebietAnzeige { id, einsatz_id, label,
  zonen_ids: Vec<i64>, hoechste_warnstufe: String }`.
- `repo.rs`:
  - Matrix-Funktionen von `einsatz_id` auf `gefahrengebiet_id` umstellen: `liste`,
    `aktuelle_warnstufe`, `upsert_bewertung` (`warnstufe='keine'` = Zelle effektiv leeren).
  - `lazy_create_zelle` **entfällt** (kein Einzelzeiger mehr).
  - Neu: `gebiete_liste(einsatz_id)` (inkl. `zonen_ids` + `hoechste_warnstufe`),
    `gebiet_anlegen(einsatz_id, label, benutzer)`, `gebiet_umbenennen(gid, label)`,
    `gebiet_aufraeumen_wenn_leer(gid)`.
  - Unit-Tests.

### Routen (`src/routes/gefahr.rs`)

| Verb | Pfad | Zweck |
|---|---|---|
| GET | `/einsaetze/:id/gefahrengebiete` | Liste der Gebiete (Übersicht + Karten-Styling) |
| GET | `/einsaetze/:id/gefahrengebiete/:gid/matrix` | Zellen eines Gebiets |
| PUT | `/einsaetze/:id/gefahrengebiete/:gid/matrix/bewertung` | UPSERT Zelle + ETB + Live |
| PATCH | `/einsaetze/:id/gefahrengebiete/:gid` | Label umbenennen |

Body `PUT .../bewertung`: `{gefahrentyp, schutzobjekt, warnstufe, beschreibung?,
gemeldet_von?}`; validiert Enums + `kombination_gueltig`.

### Merge über die Zonen-Route (`src/routes/lage_zone.rs`)

`PATCH /einsaetze/:id/zonen/:zid` akzeptiert neu `gefahrengebiet_id` (Tri-State-
Deserializer wie gehabt) **statt** `gefahrentyp/schutzobjekt`:
- gesetzt auf Ziel-Gruppe → Merge (Zone adoptiert Ziel-Matrix).
- `null` oder „neu" → eigene Gruppe (Detach / Auto-Gruppe-von-eins).
- Repo räumt leer gewordene Quellgruppen auf.

`src/lage_zone/`:
- `mod.rs` — `LageZoneAnzeige`: `gefahrentyp/schutzobjekt` raus, `gefahrengebiet_id:
  Option<i64>` rein. Validierung `gefahren_zuordnung_gueltig` → ersetzt durch Prüfung „nur
  `gefahrengebiet`-Zonen dürfen `gefahrengebiet_id` tragen; Ziel-Gruppe gehört zum selben
  Einsatz".
- `repo.rs` — `anlegen`: bei `typ='gefahrengebiet'` automatisch Gefahrengebiet anlegen +
  `gefahrengebiet_id` setzen. `aktualisiere`: Umhängen, Typ-Wechsel, Cleanup leerer Gruppen
  (Merge gegen Effektivzustand, Memory `patch-xor-effektivzustand`). `loese_auf`: nach
  Zonen-Löschung leere Gruppe aufräumen.

### ETB / Live / Berechtigung (wie LFH-53)

- **ETB** nur bei realer Warnstufen-Änderung (auch `keine` ↔ Wert), Wortlaut mit Gebiets-
  Label im `«…»`-Format, z. B.: `Gefahr «Brand» für «Menschen» in «Gefahrengebiet Nord» auf
  Warnstufe «hoch» gesetzt.` Reine Beschreibungs-/`gemeldet_von`-Änderungen ohne Warnstufen-
  Wechsel erzeugen **keinen** ETB-Eintrag. Merge/Umbenennen erzeugen keinen ETB-Eintrag
  (organisatorisch).
- **Live**: Kanal `gefahr` über die bestehende `LiveHub`-Infrastruktur (einsatzweiter
  Multiplex-Kanal, konsumiert über `useEinsatzLiveStream`). Payload `{einsatz_id,
  gefahrengebiet_id}`. Zonen weiter über Kanal `lage_zone`. Merge/Umhängen publiziert
  `lage_zone` **und** `gefahr` (Gebiete-Liste hat sich geändert).
- **Berechtigung**: GET/stream → `fordere_lesezugriff`; PUT/PATCH → `fordere_schreibrecht`
  + `fordere_aktiv`. Org-Isolation wie überall.

### Einhängen

`src/lib.rs` / `src/routes/mod.rs` / `src/app.rs` — neue Routen registrieren.

## Frontend

- **`api/types.ts`** — neu `Gefahrengebiet { id, einsatz_id, label, zonen_ids,
  hoechste_warnstufe }`; `GefahrBewertung.einsatz_id` → `gefahrengebiet_id`; `LageZone`:
  `gefahrentyp/schutzobjekt` raus, `gefahrengebiet_id: number | null` rein.
- **`api/gefahren.ts`** — `ladeGefahrengebiete(einsatzId)`, `ladeMatrix(einsatzId, gid)`,
  `setzeBewertung(einsatzId, gid, daten)`, `benenneGefahrengebiet(einsatzId, gid, label)`.
- **`api/lagezonen.ts`** — `ZoneNeu`/`ZonePatch`: `gefahrengebiet_id` statt
  `gefahrentyp/schutzobjekt`.
- **Neu `pages/gefahren/GefahrenMatrix.tsx`** — das wiederverwendbare 13×5-Grid (Warnstufen-
  Dropdown je Zelle, Farbcodierung, ungültige Zellen ausgegraut, Beschreibung/`gemeldet_von`
  im Detail-Popover). Genutzt von GefahrenPage **und** Inspector-Drawer (eine Wahrheit).
- **`pages/gefahren/GefahrenPage.tsx`** — links Liste der Gefahrengebiete (mit höchster
  Warnstufe je Gebiet), rechts `GefahrenMatrix` des gewählten Gebiets.
  `gefahrenSchema.ts` (Kataloge/`kombinationGueltig`/`warnstufeFarbe`) bleibt.
- **`pages/lagekarte/ZonenInspector.tsx`** — statt Gefahrentyp/Schutzobjekt-Selects:
  „Gehört zu Gefahrengebiet: [Dropdown bestehender Gruppen | + neues]" (Umhängen/Detach) +
  Button „Matrix bearbeiten" → Drawer mit `GefahrenMatrix` des Gebiets. Warnung, falls die
  aktuelle Gruppe vor dem Umhängen bereits Warnstufen trägt.
- **Karten-Styling** — Zonenfarbe/Badge aus höchster Warnstufe des Gefahrengebiets.
- **Live/Invalidierung** — `useEinsatzLiveStream`: `gefahr`-Event invalidiert Gebiete- und
  Matrix-Queries; `lage_zone`-Event invalidiert Zonen (wie gehabt).

## Tests

**Backend (`tests/gefahr.rs`, umgestellt):**
- Auto-Gruppe bei Zonen-Anlage (`typ='gefahrengebiet'` → Gefahrengebiet existiert).
- Matrix leer → leere Liste; `PUT` legt Zelle an; erneutes `PUT` aktualisiert (UPSERT);
  `warnstufe='keine'` leert die Zelle.
- Ungültiger Enum-Wert → 422; ungültige Kombination → 422.
- ETB-Eintrag bei Warnstufen-Wechsel; **kein** ETB bei reiner Beschreibungs-Änderung.
- SSE: `PUT` löst `gefahr`-Event aus.
- Berechtigung (Lesezugriff/Schreibrecht/aktiv) + Org-Isolation.

**Backend `lage_zone` (`tests/lage_zone.rs`, erweitert):**
- Merge: Zone auf Ziel-Gruppe umhängen → `gefahrengebiet_id` gesetzt; Zone adoptiert Ziel-
  Matrix; leer gewordene Quellgruppe wird aufgeräumt.
- Letzte Zone eines Gefahrengebiets löschen → Gebiet + Matrix weg.
- `gefahrengebiet_id` an Nicht-`gefahrengebiet`-Zone → 422; Ziel-Gruppe aus fremdem Einsatz
  → 422/abgelehnt.
- Detach (PATCH `gefahrengebiet_id=null` bzw. neue Gruppe) → eigene Gruppe.

**Frontend (Vitest, volle Suite via `--no-file-parallelism`, Memory
`frontend-testsuite-parallel-timeouts`):**
- `gefahrenSchema.test.ts` — `kombinationGueltig` deckt die ungültigen Paare ab.
- `GefahrenMatrix.test.tsx` — Raster 13×5; Warnstufe setzen ruft API; ungültige Zellen
  disabled; Live-Event invalidiert.
- `GefahrenPage.test.tsx` — Gebiete-Liste rendert; Auswahl zeigt die Matrix des Gebiets.

## Phasen (für den Implementierungsplan)

Jede Phase mit TDD. Gates: `cargo test` bzw. Vitest (`--no-file-parallelism`) + `pnpm build`.

1. **Migration + Backend-Modell** — Migration 0041, `gefahrengebiet`-Repo, Matrix-Repo-
   Umstellung auf `gefahrengebiet_id`, `tests/gefahr.rs` anpassen.
2. **Backend Routen + Zonen-Integration** — Gebiete-/Matrix-Routen, Zonen-PATCH-Merge,
   Auto-Gruppe/Cleanup, ETB/Live, `tests/lage_zone.rs`.
3. **Frontend** — Typen/API, `GefahrenMatrix`, GefahrenPage-Übersicht, ZonenInspector-Umbau
   (Gruppen-Dropdown + Matrix-Drawer), Karten-Styling, Live-Invalidierung, Vitest.

## Bewusst NICHT in diesem Teilprojekt (Abgrenzung)

- **Einsatzabschnitt-Verknüpfung** — vom User zurückgestellt, ggf. späterer separater Punkt.
- **Geometrie-Union** der Polygone — Zusammenlegen ist Gruppen-Zuordnung, keine Union.
- **Aggregat-/Gesamtlage-Ansicht** über alle Gebiete (höchste Warnstufe je Zelle einsatzweit)
  — nicht in diesem Schritt; evtl. später.
- **Datenmigration** der einsatzweiten LFH-53-Matrix — Bestand faktisch leer, kein Erhalt.
