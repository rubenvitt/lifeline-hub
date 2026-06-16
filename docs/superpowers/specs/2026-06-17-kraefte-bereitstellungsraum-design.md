# Kräfte-Bereitstellungsraum (LFH-14)

**Kontext:** Aus LFH-58 (UHS Bugs & Verbesserungen) ausgegliedert. Die Klärung von LFH-14
(„E-3 UHS: Bereitstellungsraum und Patienten klären") ergab: Ein **Bereitstellungsraum (BR)**
ist fachlich (BOS) ein Ort, an dem **Einsatzkräfte und Fahrzeuge** bereitgehalten werden,
bevor sie einem Abschnitt zugeteilt werden — **keine Patienten**. Er gehört damit **nicht**
in die patienten-zentrische UHS-Schicht (`src/uhs/`), sondern wird ein **eigenes Modul**
neben `src/einheit/` / `src/fahrzeug/`.

## Worum es geht

Heute existiert `bereitstellungsraum` nur als inerter `UhsTyp`-Enum-Wert
(`src/uhs/mod.rs`, `migrations/0027_uhs.sql`), operativ wie jeder andere UHS-Typ behandelt —
also patienten-zentrisch belegt. Das ist fachlich falsch. Diese Spec baut den BR als
eigenständige, **einsatz-scoped** Struktur, in die **Einheiten und (einheitenlose) Fahrzeuge**
bereitgestellt werden, mit **append-only Belegungs-Historie** (analog E-3-UHS), und entfernt
`bereitstellungsraum` aus `UhsTyp`.

Strukturelle Leitlinien (an E-3 angelehnt, bewusst wiederverwendet):

1. **Eigenständige einsatz-scoped Entity mit Lebenszyklus** (`geplant → aktiv → aufgeloest`),
   Soft-Delete für Fehleingaben — identische Status-Maschine wie UHS.
2. **Polymorphe Belegung über Code-Guard, kein FK.** Ein Belegungs-Event referenziert
   `(objekt_typ ∈ {einheit, fahrzeug}, objekt_id)`. Kein DB-FK (zwei mögliche Zieltabellen) —
   Integrität app-seitig, vgl. das bestehende „polymorpher Bezug"-Muster (Referenz auf
   Bestehendes, keine Heraufstufung).
3. **Einheit bringt ihre Fahrzeuge implizit mit.** Steht eine Einheit im BR, gelten ihre
   Mitglieds-Fahrzeuge (`einsatz_fahrzeug.einheit_id = einheit.id`) als mit-bereitgestellt.
   Eigenständige Fahrzeug-Belegung ist **nur** für Fahrzeuge **ohne** Einheit zulässig
   (`einheit_id IS NULL`). Das verhindert Doppelzählung und Widersprüche.

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Einsatz-scoped, kein globaler Stamm.** BR-Instanzen existieren nur im Einsatz.
2. **Optionale Abschnittszuordnung** (`abschnitt_id` nullable → `einsatzabschnitt`), Leitung
   implizit über den Abschnitt (kein eigenes `leiter_id`).
3. **Status-Maschine** `geplant → aktiv → aufgeloest` (terminal) + Soft-Delete
   (`storniert_at`). Belegung erst ab `aktiv`. Auflösung/Storno blockt bei aktiver Belegung
   (`409`).
4. **Belegungs-Objekte:** `einheit` (= `einsatz_einheit`) und `fahrzeug` (= `einsatz_fahrzeug`).
   Event-`art ∈ {eintritt, wechsel, austritt}`, append-only.
5. **Cache-Spalten** `aktueller_br_id` (nullable) auf `einsatz_einheit` **und**
   `einsatz_fahrzeug`, in derselben Tx wie der Event-Insert gepflegt (E-3-Muster).
6. **Einheit-bringt-Fahrzeuge-Regel** (s. o.): Fahrzeug-Belegung nur bei `einheit_id IS NULL`,
   sonst `409`/`422`. Member-Fahrzeuge werden über die Einheit abgeleitet, nicht doppelt
   gebucht.
7. **Berechtigung/Audit identisch zu UHS:** Lesen `darf_lesen` (Mitgliedschaft +
   Nachlauffrist), Schreiben `ist_schreibberechtigt`, abgeschlossener Einsatz read-only
   (`fordere_aktiv`), `einsatz_id`-Prädikat in jeder Query.
8. **ETB-Spur (nicht pseudonym).** Kräfte tragen keine Patientenidentität — ETB-Einträge
   nennen Einheits-Name bzw. Funkrufname. Spur bei Lifecycle (`aktiv`/`aufgeloest`) und
   Belegungs-Events. **Keine** ETB-Spur für reine Stammfeld-Änderungen.
9. **SSE-Event** `bereitstellungsraum` (Payload nur IDs), Clients refetchen.
10. **`UhsTyp::Bereitstellungsraum` wird entfernt** (Rust-Enum + Frontend-Typ + UI-Option +
    CHECK-Constraint per Tabellen-Rebuild-Migration). Bestandsdaten: im Dev-Stand keine
    `typ='bereitstellungsraum'`-Zeilen erwartet; die Migration prüft/setzt etwaige Altzeilen
    defensiv auf `'sonstige'` vor dem CHECK-Rebuild.

## Scope

**Drinnen:**

- BR-Entity (einsatz-scoped, Status-Maschine, Soft-Delete).
- `br_belegung` (append-only) + Cache-Spalten `aktueller_br_id` auf `einsatz_einheit` und
  `einsatz_fahrzeug`.
- Polymorphe Belegungs-Semantik (Einheit/Fahrzeug) + Einheit-bringt-Fahrzeuge-Regel.
- Routen (BR-CRUD, Status-Wechsel, Belegungs-Event).
- ETB-Spur (Lifecycle + Belegung), SSE-Event `bereitstellungsraum`.
- Frontend-Modul „Bereitstellungsräume" (Liste + Detail + Zuweisen/Entfernen + Sidebar
  „Kräfte ohne BR").
- **Cleanup:** `bereitstellungsraum` aus `UhsTyp` (Rust + Frontend + CHECK).

**Draußen (spätere Specs):**

- BR-**Templates**/Standard-Aufbauten.
- **Karten-Verortung** (Geo) — T4 Lagekarte.
- **Stärke-Aggregation** im BR (Summen über bereitgestellte Kräfte) — später, falls gebraucht.
- **Cross-Modul-Auto-Austritt** (z. B. Einheit aufgelöst → BR-Austritt) — später, falls Bedarf.

## Datenmodell

Additiv ab `0060` (höchste bestehende Migration: `0059`).

```sql
-- Migration 0060_bereitstellungsraum.sql
CREATE TABLE bereitstellungsraum (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id  INTEGER REFERENCES einsatzabschnitt(id),
    bezeichnung   TEXT    NOT NULL,                  -- "BR Nord", "BR 1"
    standort      TEXT,                              -- Freitext
    notiz         TEXT,
    status        TEXT    NOT NULL DEFAULT 'geplant'
                  CHECK (status IN ('geplant','aktiv','aufgeloest')),
    erfasst_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at  TEXT,
    UNIQUE (einsatz_id, bezeichnung)
);
CREATE INDEX idx_br_einsatz ON bereitstellungsraum (einsatz_id, status);
CREATE INDEX idx_br_abschnitt ON bereitstellungsraum (abschnitt_id);
```

```sql
-- Migration 0061_br_belegung.sql  (append-only — kein UPDATE/DELETE)
ALTER TABLE einsatz_einheit  ADD COLUMN aktueller_br_id INTEGER REFERENCES bereitstellungsraum(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN aktueller_br_id INTEGER REFERENCES bereitstellungsraum(id);

CREATE TABLE br_belegung (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    br_id        INTEGER NOT NULL REFERENCES bereitstellungsraum(id),
    objekt_typ   TEXT    NOT NULL CHECK (objekt_typ IN ('einheit','fahrzeug')),
    objekt_id    INTEGER NOT NULL,                  -- einsatz_einheit.id ODER einsatz_fahrzeug.id (Code-Guard, kein FK)
    art          TEXT    NOT NULL CHECK (art IN ('eintritt','wechsel','austritt')),
    notiz        TEXT,
    zeitpunkt_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von  INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_br_belegung_br     ON br_belegung (br_id, zeitpunkt_at);
CREATE INDEX idx_br_belegung_objekt ON br_belegung (objekt_typ, objekt_id, zeitpunkt_at);
```

```sql
-- Migration 0062_uhs_typ_ohne_bereitstellungsraum.sql
-- bereitstellungsraum aus dem UhsTyp-CHECK entfernen (SQLite: Tabellen-Rebuild).
-- Defensiv etwaige Altzeilen umsetzen, dann uhs neu mit engerem CHECK aufbauen.
UPDATE uhs SET typ = 'sonstige' WHERE typ = 'bereitstellungsraum';
-- (Rebuild der uhs-Tabelle mit CHECK ohne 'bereitstellungsraum' — Detailschritte im Plan,
--  Spalten/Indizes identisch zu 0027, nur der typ-CHECK ändert sich.)
```

**Cache-Konsistenz:** Jeder `br_belegung`-Insert pflegt in derselben Tx
`aktueller_br_id` auf der betroffenen `einsatz_einheit`/`einsatz_fahrzeug`-Zeile.

## Status-Maschine

Identisch zu UHS (`src/uhs/mod.rs::darf_uebergehen`): `geplant → aktiv → aufgeloest`,
`geplant → aufgeloest` direkt erlaubt, `aufgeloest` terminal. Wiederverwendbare freie Funktion
im neuen Modul (gleiche Logik; bei Bedarf gemeinsame Hilfsfunktion extrahieren).

- **Anlegen** → `geplant`. Stammfelder editierbar, **keine** Belegung.
- `geplant → aktiv` — ab jetzt Belegungs-Events erlaubt.
- `aktiv → aufgeloest` — nur wenn keine aktive Belegung (`NOT EXISTS` über beide Cache-Spalten),
  sonst `409`.
- **Soft-Delete** jederzeit, gleiche Belegungs-Bedingung wie Auflösung.

## Belegungs-Modell

| `art` | Bedeutung | Vorbedingungen |
|---|---|---|
| `eintritt` | Objekt betritt den BR | Objekt hat keinen aktiven BR (`aktueller_br_id IS NULL`); Ziel-BR = `aktiv`; bei Fahrzeug: `einheit_id IS NULL` |
| `wechsel` | Objekt wechselt den BR | Objekt hat aktiven BR; Ziel-BR = `aktiv`; bei Fahrzeug: `einheit_id IS NULL` |
| `austritt` | Objekt verlässt den BR | Objekt hat aktiven BR |

**Einheit-bringt-Fahrzeuge-Regel:** `objekt_typ='fahrzeug'` ist nur zulässig, wenn das
`einsatz_fahrzeug` **keine** `einheit_id` hat. Member-Fahrzeuge sind über die Belegung ihrer
Einheit abgedeckt; die Detail-/Auslastungsanzeige leitet sie aus der Einheit ab.

## Berechtigung & Audit

Wie UHS: Lesen `darf_lesen`, Schreiben `ist_schreibberechtigt`, `fordere_aktiv`,
`einsatz_id`-Scoping in jeder Query, Routen unter dem Einsatz-Scope. Kein eigenes Lese-Audit
(keine sensiblen Personendaten).

## ETB-Integration

Über `etb_system` (typ=system), **nicht** pseudonym:

| Ereignis | Beispieltext |
|---|---|
| BR-Status `aktiv` | „BR Nord in Betrieb genommen" |
| BR-Status `aufgeloest` | „BR Nord aufgelöst" |
| Belegung `eintritt` Einheit | „Einheit 1. Zug FF: Eintritt BR Nord" |
| Belegung `eintritt` Fahrzeug | „Florian 1/44: Eintritt BR Nord" |
| Belegung `austritt` | „… verlässt BR Nord" |

**Keine** ETB-Spur bei Stammfeld-PATCH/Anlegen (`geplant`).

## Live / SSE

Ein Event-Typ `bereitstellungsraum` (Payload `einsatz_id` + `br_id`) bei BR-/Belegungs-Änderung.
Zusätzlich `einheit`-/`fahrzeug`-SSE (falls vorhanden) bei Belegungs-Event antriggern, damit
die Kräfte-Ansichten refetchen.

## Routen (API)

Alle unter `/api/einsaetze/:id/`, im Einsatz-Scope (Lese-/Schreib-Gate). Spiegelt UHS.

| Methode | Pfad | Zweck | Recht |
|---|---|---|---|
| `GET` | `/bereitstellungsraeume` | Liste (Filter `?status=`, `?abschnitt_id=`) | Lesen |
| `POST` | `/bereitstellungsraeume` | BR anlegen (`geplant`) | Schreiben |
| `GET` | `/bereitstellungsraeume/:bid` | Detail (BR + bereitgestellte Einheiten/Fahrzeuge) | Lesen |
| `PATCH` | `/bereitstellungsraeume/:bid` | Stammfelder | Schreiben |
| `POST` | `/bereitstellungsraeume/:bid/status` | Status-Wechsel | Schreiben |
| `DELETE` | `/bereitstellungsraeume/:bid` | Soft-Delete | Schreiben |
| `POST` | `/bereitstellungsraeume/:bid/belegung` | Belegungs-Event (`objekt_typ`, `objekt_id`, `art`, `notiz?`) | Schreiben |

## Frontend

Neues Modul „Bereitstellungsräume" (Kategorie Kräfte/Mittel), Muster analog UHS/Einheiten.

- **Liste:** Karten mit Status-Badge + Auslastung (Anzahl Einheiten/Fahrzeuge), Filter
  Abschnitt/Status, Schnellanlage.
- **Detail:** bereitgestellte Einheiten + (einheitenlose) Fahrzeuge; Aktionen Zuweisen
  (aus „Kräfte ohne BR") und Entfernen (Austritt); Inbetriebnahme/Auflösung als Buttons;
  Bewegungs-Liste (`br_belegung`).
- **Sidebar „Kräfte ohne BR":** Einheiten/Fahrzeuge mit `aktueller_br_id IS NULL`
  (Fahrzeuge nur einheitenlos).
- Schreibaktionen für Beobachter / abgeschlossenen Einsatz / `geplant`-BR disabled.

## Tests

**Repo/HTTP:**

- BR-CRUD; Status-Übergänge (gültig/`422`); Auflösung+Storno blocken bei aktiver Belegung
  (`409`); `geplant`-BR akzeptiert keine Belegung (`422`).
- Belegung Einheit: eintritt/wechsel/austritt, Cache `aktueller_br_id` konsistent.
- Belegung Fahrzeug **einheitenlos** erlaubt; Fahrzeug **mit** `einheit_id` → `409`/`422`.
- Polymorpher Guard: unbekannter `objekt_typ` → `400`; fremdes/nicht existierendes `objekt_id`
  → `404`.
- Org-Isolation (fremder Einsatz → `403`/`404`), Beobachter kann nicht schreiben,
  abgeschlossener Einsatz read-only.
- ETB: Lifecycle + Belegung erzeugen genau einen `system`-Eintrag; Stammfeld-Änderung keinen.
- `UhsTyp`-Cleanup: `UhsTyp::parse("bereitstellungsraum") == None`; UHS-Anlage mit
  `typ='bereitstellungsraum'` → abgelehnt.

**Frontend:**

- Liste rendert BRs; Detail zeigt bereitgestellte Kräfte.
- Zuweisen Einheit/Fahrzeug → POST Belegung mit korrektem `objekt_typ`/`art`.
- Entfernen → Austritt.
- Sidebar filtert `aktueller_br_id IS NULL`.
- Disabled-Zustände (Beobachter / abgeschlossen / `geplant`).

## Offene Punkte / Folge-Specs

- Stärke-Aggregation im BR (Summen) — später.
- Cross-Modul-Auto-Austritt (Einheit/Fahrzeug abgemeldet → BR-Austritt) — später.
- Karten-Verortung (T4), BR-Templates — später.
