# E‑3 — Unfallhilfsstellen

**Teilprojekt:** 3 „Erfassung" — Spec **3 von 5**. Ersetzt den `antreff_ort`-Freitext
aus [E‑1](2026-05-27-erfassung-personen-fundament-design.md) durch eine **strukturierte
interne Örtlichkeit** und legt die operative Versorgungs-Struktur eines Einsatzes als
Datenmodell ab: Unfallhilfsstelle (PA, BHP, VSS, …) als Container für **benannte Plätze**
(Bett, Intensivplatz, Wartebereich, …), an die Personen zugeordnet werden, und für
**verortetes Einsatzmaterial**.

**Unterbau (wiederverwendet, nicht neu gebaut):** Personen-Entity + administrative
Status-Maschine ([E‑1](2026-05-27-erfassung-personen-fundament-design.md), `src/person/`,
Migr. `0020`–`0021`), Cache + Verbleib aus [E‑2](2026-05-27-erfassung-sichtung-medizinischer-verlauf-design.md)
(Migr. `0022`–`0026`), Einsatzabschnitt (`src/einsatzabschnitt/`, Migr. `0014`),
Material-Modul ([K&M‑4](2026-05-27-kraefte-mittel-material-disposition-design.md), Migr. `0018`–`0019`),
pseudonyme ETB-Spur (`etb_system`-Helfer), SSE-Live, Rollen-/Nachlauf-Gate
(`src/einsatz/berechtigung.rs`).

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 3 — Erfassung".

## Worum es geht

E‑1 hat den Personen-Stamm angelegt und `antreff_ort` als Freitext belassen — bewusst, mit
dem Hinweis „strukturierte Zuordnung kommt in E‑3". E‑2 hat den **externen** Verbleib
(Transport/Entlassung/verstorben) modelliert, ebenfalls mit dem Hinweis: die *interne*
Örtlichkeit (Patientenablage, Behandlungsplatz, Verletztensammelstelle) ist E‑3.

Diese Spec baut genau diese interne Schicht. Eine UHS ist keine wiederverwendbare
Org-Ressource (anders als ein RTW oder eine Trage), sondern eine **im Einsatz vor Ort
eingerichtete Versorgungs-Struktur**. Patienten wandern darin durch *Plätze* (Eingang →
Behandlungsplatz → Transport-Bereitstellung), und die UHS selbst hat einen *Lebenszyklus*
(geplant → aktiv → aufgelöst).

Drei strukturelle Punkte treiben das Design:

1. **Plätze sind erstklassige Entitäten** — Personen werden konkreten Plätzen zugewiesen,
   nicht der UHS als Ganzes. Damit ist „wer liegt auf Bett 3" eine direkte Abfrage und der
   Personenfluss durch eine UHS exakt rekonstruierbar.
2. **Implizite Inbox** — jede UHS hat einen impliziten Eingangs-/Sammelbereich („Inbox"),
   modelliert als Belegung mit `platz_id = NULL`. Das vermeidet eine zweite Belegungs-Logik
   für „in UHS, aber noch nicht auf einem Platz" und macht den Eingang **unbegrenzt**, ohne
   den 1:1-Constraint für echte Plätze aufzuweichen.
3. **Verfügbarkeit getrennt von Belegung** — ein Platz ist nicht nur „belegt oder frei",
   sondern hat einen eigenen Verfügbarkeits-Zustand (`frei | defekt | aufbereitung |
   gesperrt | reserviert`). Damit lässt sich Realität abbilden: Bett ist kaputt, muss
   aufbereitet werden, ist für eine bestimmte Person reserviert.

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Einsatz-scoped, Typ-Enum.** UHS-Instanzen existieren nur im Einsatz; kein globaler
   Stamm, keine Disposition. Typ ist ein fester Rust-Enum (`patientenablage`,
   `behandlungsplatz`, `verletztensammelstelle`, `bereitstellungsraum`, `sonstige`).
2. **Optionale Abschnittszuordnung.** UHS hat nullable `abschnitt_id` → `einsatzabschnitt`.
   UHS-Leitung **implizit** über den Abschnitt (kein eigenes `leiter_id`-Feld) — bei Bedarf
   später nachrüstbar.
3. **Plätze sind benannte 1:1-Slots; Inbox ist implizit.** `uhs_platz` mit Typ
   (`wartebereich`, `behandlungsplatz`, `bett`, `intensivplatz`, `trage`,
   `transport_bereitstellung`, `sonstige`) und 1:1-Belegung (partieller Unique-Index auf
   `einsatz_person.aktueller_platz_id`). Belegung mit `platz_id = NULL` = Person ist in der
   UHS, aber noch in der unbegrenzten Inbox — kein eigener Platz-Typ `eingang`.
4. **Event-zentrisches Belegungs-Modell.** Append-only `person_uhs_belegung` mit
   `art ∈ {eintritt, wechsel, austritt}`; Cache `aktuelle_uhs_id` + `aktueller_platz_id` auf
   `einsatz_person` (E‑2-Muster, in derselben Transaktion gepflegt).
5. **Status-Maschine UHS:** `geplant → aktiv → aufgeloest` + Soft-Delete (`storniert_at`)
   für Fehleingaben. `aufgeloest` ist terminal.
6. **Auflösung und Storno blockieren bei aktiver Belegung** (HTTP `409 Conflict`).
   Identische Semantik für beides: eine UHS mit Personen drin ist offensichtlich keine
   Fehleingabe.
7. **Material-Verortung über `einsatz_material.uhs_id`** (nullable). UHS-Detail erlaubt
   Zuordnen/Lösen disponierter Materialposten. Kein neuer Material-Stamm.
8. **Pseudonyme ETB-Spur + SSE + Lese-Audit wiederverwenden.** ETB-Einträge `typ=system`
   mit `registrier_nr` + UHS-Bezeichnung + ggf. Platz; **keine** Identität. SSE-Event-Typen
   `uhs` und `person` (Payload nur IDs).
9. **Schlankes Grundriss-Schema in E‑3.** `pos_x`/`pos_y` (REAL) auf `uhs_platz`,
   AntD + `@dnd-kit` im Frontend. Kein vollwertiges Karten-Tool — das ist T4 Lagekarte
   (`uhs.standort` ist Freitext und wird in T4 ggf. um Geo-Koordinaten ergänzt).
10. **Verfügbarkeit der Plätze:** Spalte `verfuegbarkeit ∈ {frei, defekt, aufbereitung,
    gesperrt, reserviert}` auf `uhs_platz`. Belegung („wer liegt drauf") wird über
    `einsatz_person.aktueller_platz_id` abgeleitet, nicht als zusätzlicher Status.
    `eintritt`/`wechsel` blockt mit `422`, wenn `verfuegbarkeit != 'frei'` — Ausnahme:
    `reserviert` mit passender `reserviert_fuer_person_id` (siehe (12)).
11. **Auto-Aufbereitung nur, wenn vorher `frei`.** Jedes *Verlassen* eines Platzes
    (sowohl `austritt` als auch `wechsel`-out) setzt den ehemaligen Platz auf
    `verfuegbarkeit = 'aufbereitung'` **nur**, wenn er vorher `frei` war. `defekt`/
    `gesperrt`/`reserviert` bleiben — Aufbereiten eines defekten Bettes ist sinnlos.
12. **Reservierte Person belegt ihren Platz direkt.** `eintritt`/`wechsel` auf einen
    `reserviert`-Platz ist erlaubt, wenn `person_id = reserviert_fuer_person_id`. In
    derselben Transaktion wird `verfuegbarkeit = 'frei'` gesetzt und
    `reserviert_fuer_person_id` geleert — die Reservierung wird durch Belegung eingelöst.
13. **UHS-zu-UHS-Wechsel = ein `wechsel`-Event.** Ein einzelnes Event mit neuer `uhs_id`
    UND `platz_id` (oder `platz_id = NULL` für Inbox-Ziel). Aus Personensicht ist das
    *eine* Verlegung → ein ETB-Eintrag.
14. **Cross-Modul-Auto-Austritt über `uhs_auto_austritt`-Helper.** Public Funktion im
    `src/uhs/`-Modul (analog `etb_system` aus E‑2), aufgerufen aus E‑1-Status-Handler und
    E‑2-Verbleib-Handler. Schreibt **eigenen** ETB-Eintrag mit Notiz „durch Status-Wechsel
    zu verstorben / abgemeldet" bzw. „durch Verbleib transport / entlassung".

## Scope

**Drinnen (E‑3):**

- UHS-Entity (einsatz-scoped, Status-Maschine, Soft-Delete).
- `uhs_platz` (Typ + Bezeichnung + Layout-Koordinaten + Verfügbarkeit + Reservierung).
- Implizite Inbox-Semantik über `platz_id = NULL` in Belegung + Cache.
- `person_uhs_belegung` (append-only) + Cache-Spalten auf `einsatz_person`.
- 1:1-Constraint via partiellem Unique-Index.
- `einsatz_material.uhs_id` (Material-Verortung) + bestehende Material-Route erweitert.
- `uhs_auto_austritt`-Helper + Aufrufe in E‑1-Status-Handler und E‑2-Verbleib-Handler.
- Pseudonyme ETB-Spur bei Belegungs-Events (Eintritt/Wechsel/Austritt inkl. Auto-Austritt)
  + UHS-Lebenszyklus (Inbetriebnahme/Auflösung). **Keine** ETB-Spur für reine
  Verfügbarkeits-Änderungen (interne Logistik) und Material-Verortung.
- SSE-Events `uhs` (UHS-/Platz-Änderung) und `person` (zusätzlich getriggert bei Belegungs-Event).
- Routen (UHS-CRUD, Plätze-CRUD inkl. Layout, Verfügbarkeits-Wechsel, Belegungs-Events).
- Frontend-Modul „Unfallhilfsstellen" (Kategorie *Erfassung*), ersetzt `ModulStub`.

**Draußen (eigene/spätere Specs):**

- **Echtes räumliches Layout / Lagekarte** mit Geo-Koordinaten — **T4**.
- **UHS-Templates** (Standard-Aufbauten, z. B. „BHP 50") — spätere Spec.
- **Material-an-Platz** (statt UHS) — spätere Spec, falls Use-Case auftaucht.
- **UHS-spezifische Leitung** als eigener FK — spätere Spec, falls Abschnitts-Leitung nicht reicht.
- **Aufnahmebereitschaft** (`offen`/`voll`) als eigener Indikator — spätere Spec.
- **Krankenhaus-Stamm** — E‑2-Folge-Spec (`einsatz_material.ziel` bleibt Freitext).
- **Angehörigen-/Personenauskunft nach außen** — eigenes späteres Thema.

## Datenmodell

Migrations-Inventar (additiv zu E‑2, das bei `0026` endet):

| Migration | Inhalt |
|---|---|
| `0027_uhs.sql` | UHS-Entity inkl. Status-Maschine + Soft-Delete |
| `0028_uhs_platz.sql` | Plätze mit Typ, Layout-Koordinaten, Verfügbarkeit, Reservierung |
| `0029_person_uhs_belegung.sql` | Belegungs-Verlauf + Cache-Spalten auf `einsatz_person` + 1:1-Index |
| `0030_einsatz_material_uhs.sql` | Material-Verortung |

> **Hinweis Migrations-Reihenfolge:** K&M‑4 (Material-Disposition) hat eine abgestimmte
> Spec, aber **noch keinen Plan und keine eigenen Migrationen** (Stand: PROGRESS.md
> 2026-05-28). Wird K&M‑4 vor E‑3 implementiert, rücken die hier reservierten Nummern
> entsprechend weiter — sonst keine Konflikte.

```sql
-- Migration 0027_uhs.sql
CREATE TABLE uhs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id  INTEGER REFERENCES einsatzabschnitt(id),
    typ           TEXT    NOT NULL
                  CHECK (typ IN ('patientenablage','behandlungsplatz',
                                 'verletztensammelstelle','bereitstellungsraum',
                                 'sonstige')),
    bezeichnung   TEXT    NOT NULL,                  -- "PA 1", "BHP 50"
    standort      TEXT,                              -- Freitext (Adresse/Hinweis)
    notiz         TEXT,
    status        TEXT    NOT NULL DEFAULT 'geplant'
                  CHECK (status IN ('geplant','aktiv','aufgeloest')),
    erfasst_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at  TEXT,                              -- Soft-Delete (Fehleingabe)
    UNIQUE (einsatz_id, bezeichnung)
);
CREATE INDEX idx_uhs_einsatz ON uhs (einsatz_id, status);
CREATE INDEX idx_uhs_abschnitt ON uhs (abschnitt_id);
```

```sql
-- Migration 0028_uhs_platz.sql
CREATE TABLE uhs_platz (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    uhs_id                   INTEGER NOT NULL REFERENCES uhs(id) ON DELETE CASCADE,
    typ                      TEXT    NOT NULL
                             CHECK (typ IN ('wartebereich','behandlungsplatz',
                                            'bett','intensivplatz','trage',
                                            'transport_bereitstellung','sonstige')),
    bezeichnung              TEXT    NOT NULL,
    pos_x                    REAL,                   -- NULL = noch nicht platziert
    pos_y                    REAL,
    verfuegbarkeit           TEXT    NOT NULL DEFAULT 'frei'
                             CHECK (verfuegbarkeit IN ('frei','defekt','aufbereitung',
                                                       'gesperrt','reserviert')),
    reserviert_fuer_person_id INTEGER REFERENCES einsatz_person(id),
    storniert_at             TEXT,
    UNIQUE (uhs_id, bezeichnung),
    -- Reservierung erfordert eine Ziel-Person:
    CHECK (verfuegbarkeit <> 'reserviert' OR reserviert_fuer_person_id IS NOT NULL),
    -- Nicht-Reservierung hat keine Person:
    CHECK (verfuegbarkeit = 'reserviert' OR reserviert_fuer_person_id IS NULL)
);
CREATE INDEX idx_uhs_platz_uhs ON uhs_platz (uhs_id);
CREATE INDEX idx_uhs_platz_reserviert ON uhs_platz (reserviert_fuer_person_id);
```

```sql
-- Migration 0029_person_uhs_belegung.sql  (append-only — kein UPDATE/DELETE)
ALTER TABLE einsatz_person ADD COLUMN aktuelle_uhs_id    INTEGER REFERENCES uhs(id);
ALTER TABLE einsatz_person ADD COLUMN aktueller_platz_id INTEGER REFERENCES uhs_platz(id);

-- 1:1-Constraint: ein Platz max. eine Person gleichzeitig.
-- Inbox ist unbegrenzt — der partielle Filter `aktueller_platz_id IS NOT NULL`
-- lässt mehrere Personen mit (uhs gesetzt, platz NULL) zu.
CREATE UNIQUE INDEX idx_einsatz_person_platz_belegt
    ON einsatz_person (aktueller_platz_id)
    WHERE aktueller_platz_id IS NOT NULL;

CREATE TABLE person_uhs_belegung (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id    INTEGER NOT NULL REFERENCES einsatz_person(id),
    uhs_id       INTEGER NOT NULL REFERENCES uhs(id),
    platz_id     INTEGER REFERENCES uhs_platz(id),     -- NULL = Inbox / Austritt
    art          TEXT    NOT NULL
                 CHECK (art IN ('eintritt','wechsel','austritt')),
    notiz        TEXT,                                 -- z. B. „durch Status-Wechsel zu verstorben"
    zeitpunkt_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von  INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_uhs_belegung_person ON person_uhs_belegung (person_id, zeitpunkt_at);
CREATE INDEX idx_person_uhs_belegung_uhs    ON person_uhs_belegung (uhs_id,    zeitpunkt_at);
```

```sql
-- Migration 0030_einsatz_material_uhs.sql
ALTER TABLE einsatz_material ADD COLUMN uhs_id INTEGER REFERENCES uhs(id);
CREATE INDEX idx_einsatz_material_uhs ON einsatz_material (uhs_id);
```

**Cache-Konsistenz:** Jeder Belegungs-Event-Insert aktualisiert in **derselben Transaktion**
`einsatz_person.aktuelle_uhs_id`/`aktueller_platz_id`. Da Zeitstempel Server-Jetzt sind
(E‑2-Annahme 9), ist „jüngster Event = zuletzt eingefügt" garantiert — kein „bin ich der
jüngste?"-Check nötig.

## Status-Maschine UHS

```
        anlegen
           │
           ▼
       geplant ────────────► aufgeloest (terminal)
           │                    ▲
           ▼                    │
        aktiv ──────────────────┘
        (Belegungen erlaubt)    (nur, wenn keine aktive Belegung; sonst 409)
```

- **Anlegen** → immer `geplant`. Stammfelder + Plätze frei editierbar; **keine** Belegungen erlaubt.
- `geplant → aktiv` — Inbetriebnahme; **erst jetzt** sind Belegungs-Events erlaubt.
- `aktiv → aufgeloest` — Auflösung. Nur erlaubt, wenn `NOT EXISTS (SELECT 1 FROM einsatz_person WHERE aktuelle_uhs_id = uhs.id)`; sonst `409 Conflict` mit Hinweis „N Personen noch belegt".
- `aufgeloest` terminal.
- **Soft-Delete** (`storniert_at`) jederzeit, **aber** mit derselben Belegungs-Bedingung wie Auflösung (siehe Annahme 6).
- Ungültiger Übergang → `422`.

**Platz-Soft-Delete** (analog): blockt, wenn der Platz aktuell belegt ist (Person mit
`aktueller_platz_id = platz.id`), sonst `409`. Erlaubt in jedem UHS-Status; `geplant`-Phase
ist die typische Phase, in der Plätze noch nachgepflegt werden.

## Belegungs-Modell

Drei Event-Arten in `person_uhs_belegung`:

| `art` | Bedeutung | `platz_id` | Vorbedingungen |
|---|---|---|---|
| `eintritt` | Person betritt die UHS | `NULL` (Inbox) oder gesetzter Platz | Person hat keine aktive UHS (`aktuelle_uhs_id IS NULL`); Ziel-UHS = `aktiv`; falls Platz: Verfügbarkeits-Regel (siehe unten) |
| `wechsel` | Person wechselt UHS und/oder Platz | `NULL` (Inbox-Ziel) oder gesetzter Platz | Person hat aktive Belegung; Ziel-UHS = `aktiv`; falls neuer Platz: Verfügbarkeits-Regel |
| `austritt` | Person verlässt die UHS | `NULL` (egal) | Person hat aktive Belegung |

**Verfügbarkeits-Regel beim Belegen eines Platzes:**

1. `verfuegbarkeit = 'frei'` **und** kein anderer Belegt → erlaubt.
2. `verfuegbarkeit = 'reserviert'` **und** `reserviert_fuer_person_id = person_id` → erlaubt;
   in derselben Tx: `verfuegbarkeit = 'frei'`, `reserviert_fuer_person_id = NULL`.
3. Andernfalls (`defekt`, `gesperrt`, `aufbereitung`, oder fremd-`reserviert`) → `422`.

**Auto-Aufbereitung (Annahme 11):** Beim *Verlassen* eines Platzes (sowohl `austritt` als
auch `wechsel`-out aus einem gesetzten Platz) wird der ehemalige Platz auf
`verfuegbarkeit = 'aufbereitung'` gesetzt — **nur**, wenn er vorher `frei` war. Andere
Zustände bleiben (sinnloses Aufbereiten eines defekten Bettes wird vermieden).

**1:1-Belegung:** Der partielle Unique-Index auf `einsatz_person(aktueller_platz_id)
WHERE aktueller_platz_id IS NOT NULL` garantiert, dass ein konkreter Platz höchstens eine
Person trägt. Die Inbox (mehrere Personen mit `platz_id = NULL` in derselben UHS) ist
**explizit unbegrenzt** und vom Index nicht eingeschränkt.

## Verfügbarkeits-Statuswechsel

Eigener Endpunkt setzt `verfuegbarkeit` (und ggf. `reserviert_fuer_person_id`). Übergänge:

- `frei ↔ defekt`, `frei ↔ aufbereitung`, `frei ↔ gesperrt`, `frei ↔ reserviert (mit Person)`.
- Wechsel ist auch bei **aktiver Belegung** des Platzes möglich (informativ, z. B. „Bett ist
  beim Patienten kaputt gegangen"). Belegung bleibt unberührt; das Bett kann nach
  `austritt`/`wechsel`-out nicht durch die Auto-Aufbereitung überschrieben werden (Annahme 11).
- Reservierung setzen: Verfügbarkeit muss vorher `frei` sein und der Platz unbelegt
  (`aktueller_platz_id != platz.id` für alle Personen) — andernfalls `422`.
- Verfügbarkeits-Änderungen schreiben **keinen** ETB-Eintrag (interne Logistik) und lösen
  ein `uhs`-SSE-Event aus.

**Reservierungs-Folgekonsistenz:** Wenn die reservierte Person Soft-gelöscht wird oder den
administrativen Status `verstorben`/`abgemeldet` erreicht, wird die Reservierung in
derselben Tx aufgelöst (`verfuegbarkeit = 'frei'`, `reserviert_fuer_person_id = NULL`).

## Cross-Modul-Orchestrierung

Public Helper `uhs_auto_austritt(tx, person_id, anlass: &str) -> Result<()>` im
`src/uhs/`-Modul, analog zu `etb_system` aus E‑2. Aufruf an drei Stellen:

1. **E‑1 Status-Wechsel** (`src/routes/einsatz_person.rs::status_wechsel`): bei Ziel-Status
   `verstorben` oder `abgemeldet`, falls Person noch belegt ist → Auto-Austritt mit
   `anlass = "Status-Wechsel zu verstorben"` (bzw. `"… abgemeldet"`).
2. **E‑2 Verbleib** (`src/routes/einsatz_person.rs::verbleib`): bei Verbleib-`art`
   `transport` oder `entlassung`, falls Person noch belegt ist → Auto-Austritt mit
   `anlass = "Verbleib transport"` (bzw. `"… entlassung"`).
3. **E‑1 Soft-Delete** (`src/routes/einsatz_person.rs::stornieren`): zusätzlich werden
   etwaige Reservierungen `reserviert_fuer_person_id = person_id` aufgelöst.

Der Helper:

- schreibt einen `person_uhs_belegung`-Eintrag (`art = 'austritt'`, `platz_id = NULL`,
  `notiz = anlass`),
- löscht den Cache (`aktuelle_uhs_id = NULL`, `aktueller_platz_id = NULL`),
- triggert Auto-Aufbereitung am ehemaligen Platz (falls vorher `frei`),
- schreibt einen pseudonymen ETB-Eintrag (eigener Eintrag, zusätzlich zum E‑1-/E‑2-Eintrag —
  beide Wirkungen sind getrennt nachvollziehbar),
- löst SSE-Events `person` + `uhs` aus.

## Berechtigung & Audit

- **Lesen** (UHS-Liste, UHS-Detail, Platz-Liste, Belegungs-Liste): `darf_lesen`
  (Mitgliedschaft + Nachlauffrist; höhere Berechtigung org-übergreifend).
- **Schreiben** (UHS-CRUD, Platz-CRUD, Verfügbarkeit, Belegung): `ist_schreibberechtigt`
  (Einsatzleitung + Führungspersonal); Beobachter nur lesend. **Abgeschlossener Einsatz =
  read-only** (`fordere_aktiv`).
- **Org-Isolation:** jede Query trägt `einsatz_id`-Prädikat; Routen unter dem
  Einsatz-Scope, identisch zu allen anderen Einsatz-Sub-Routen.
- **Kein eigenes UHS-Lese-Audit.** UHS-/Platz-/Belegungs-Daten enthalten keine sensible
  Personendaten — Belegungs-Einträge tragen `person_id` (intern), aber die UI rendert nur
  `registrier_nr`. Die *Identität* einer Person hinter der `R‑nnn` ist nur über Personen-
  Detail-Zugriff sichtbar, und der ist über `person_zugriff_audit` (E‑1) auditiert.

## ETB-Integration (pseudonym)

Über den bestehenden `etb_system`-Helfer (`typ=system`, nur `registrier_nr` + UHS-Bezeichnung):

| Ereignis | Beispieltext |
|---|---|
| Belegungs-`eintritt`, `platz_id = NULL` | „Person R‑042: Aufnahme in BHP 50 (Inbox)" |
| Belegungs-`eintritt`, gesetzter Platz | „Person R‑042: Aufnahme in BHP 50 (Bett 3)" |
| Belegungs-`wechsel` innerhalb UHS | „Person R‑042: Verlegung in BHP 50 (Bett 3 → Bett 5)" |
| Belegungs-`wechsel` UHS-übergreifend | „Person R‑042: Verlegung BHP 50 → PA 1 (Wartestuhl 3)" |
| Belegungs-`austritt` (manuell) | „Person R‑042: verlässt BHP 50" |
| Belegungs-`austritt` (Auto, Status) | „Person R‑042: verlässt BHP 50 (durch Status-Wechsel zu verstorben)" |
| Belegungs-`austritt` (Auto, Verbleib) | „Person R‑042: verlässt BHP 50 (durch Verbleib transport)" |
| UHS-Status `aktiv` | „BHP 50 (Behandlungsplatz) in Betrieb genommen" |
| UHS-Status `aufgeloest` | „BHP 50 aufgelöst" |

**Keine ETB-Spur** bei: Verfügbarkeits-Wechsel, Reservierungs-Setzen/-Auflösen,
Material-Verortung, Platz-CRUD/-Layout-Änderung, UHS-`geplant`-Anlegen (erst die
Inbetriebnahme ist lagerelevant).

Jeweils in derselben Transaktion wie der fachliche Insert; danach `person`- und/oder
`uhs`-SSE-Event.

## Live / SSE

Zwei Event-Typen mit identischem Muster zu E‑1/E‑2:

- **`uhs`** — Payload nur `einsatz_id` + `uhs_id` — bei UHS-/Platz-/Verfügbarkeits-/
  Belegungs-Änderung; Clients refetchen.
- **`person`** (bestehend, E‑1) — zusätzlich bei jedem Belegungs-Event getriggert; Clients
  refetchen die betroffene Person.

Kein sensibler Payload im Stream.

## Routen (API)

Alle unter `/api/einsaetze/:id/`, montiert im Einsatz-Scope (Lese-/Schreib-Gate).

| Methode | Pfad | Zweck | Recht |
|---|---|---|---|
| `GET` | `/uhs` | Liste (Filter `?status=`, `?abschnitt_id=`) | Lesen |
| `POST` | `/uhs` | UHS anlegen (Status `geplant`) | Schreiben |
| `GET` | `/uhs/:uid` | Detail (UHS + Plätze + aktuelle Belegungen + Material) | Lesen |
| `PATCH` | `/uhs/:uid` | UHS-Stammfelder | Schreiben |
| `POST` | `/uhs/:uid/status` | Status-Wechsel (validiert) | Schreiben |
| `DELETE` | `/uhs/:uid` | Soft-Delete | Schreiben |
| `POST` | `/uhs/:uid/plaetze` | Platz anlegen | Schreiben |
| `PATCH` | `/uhs/:uid/plaetze/:pid` | Platz bearbeiten (Bezeichnung, `pos_x`/`pos_y`) | Schreiben |
| `POST` | `/uhs/:uid/plaetze/:pid/verfuegbarkeit` | Verfügbarkeit setzen (+ ggf. `reserviert_fuer_person_id`) | Schreiben |
| `DELETE` | `/uhs/:uid/plaetze/:pid` | Platz Soft-Delete | Schreiben |
| `POST` | `/personen/:pid/uhs-belegung` | Belegungs-Event (`art`, `uhs_id`, `platz_id?`, `notiz?`) | Schreiben |

**Material-Verortung:** keine eigene Route — das bestehende `PATCH /api/einsaetze/:id/material/:mid`
(K&M‑4) wird um das optionale Feld `uhs_id` erweitert.

## Frontend

Modul „Unfallhilfsstellen" (Kategorie *Erfassung*), ersetzt `ModulStub` (neuer
`modulRegistry`-Eintrag `unfallhilfsstellen`). Muster und Komponentenstruktur analog
`PersonenPage` / `EinheitenPage`.

- **Liste UHS:** Karten oder Tabelle, Status-Badge, Auslastung-Indikator (belegt/frei),
  Filter Abschnitt/Status, Schnellanlage.
- **Detail-Page** (drei Tabs):
  - **Grundriss:** zwei Drop-Bereiche nebeneinander —
    - links die **Inbox** als Sammler-Container (Personen-Karten mit `R‑nnn` + Name oder
      „unbekannt"),
    - rechts der **Grundriss** mit absolut positionierten Platz-Karten (Farbcodierung pro
      Verfügbarkeits-Status: `frei` grün, `defekt` rot, `aufbereitung` gelb, `gesperrt`
      grau, `reserviert` blau mit „für R‑nnn"-Hinweis; belegte Plätze tragen die
      Personen-Karte sichtbar).
    - **DnD-Aktionen** über `@dnd-kit`: Platz-Karte verschieben → `PATCH …/plaetze/:pid`
      (pos_x/pos_y); Personen-Karte (aus Sidebar `Personen ohne UHS`, aus Inbox, aus
      anderem Platz) auf Inbox/Platz droppen → `POST …/uhs-belegung` (`eintritt` oder
      `wechsel`); Klick auf belegte Personen-Karte → Aktion „Austritt".
    - Verfügbarkeits-Aktion pro Platz: Kontext-Menü („als defekt markieren", „als
      gereinigt (frei) markieren", „reservieren für …", …).
  - **Material:** Liste der `einsatz_material`-Posten mit `uhs_id = uhs.id` + Aktion
    „Material zuordnen" (Auswahl aus disponiertem Material ohne UHS-Zuordnung) und
    „lösen". Bestehende Material-Komponenten wiederverwenden.
  - **Bewegungen:** chronologische Tabelle aller `person_uhs_belegung`-Events der UHS
    (R‑nnn + Art + Platz + Zeit + Notiz).
- **Sidebar „Personen ohne UHS"** auf der Liste/Detail-Page: zeigt Personen mit
  `aktuelle_uhs_id IS NULL`, Status `betroffen` (Default; per Filter erweiterbar).
  Personen-Karte ist drag-bar.
- **Anlege-Flow UHS** (minimal): Typ + Bezeichnung (+ optional Abschnitt + Standort) →
  Status `geplant`. Plätze werden im Detail-View ergänzt.
- **Inbetriebnahme-Aktion** (`geplant → aktiv`) als deutlicher Button — ab dann sind
  Belegungen möglich.
- Schreibaktionen für Beobachter / abgeschlossenen Einsatz disabled (Muster K&M).

## Tests

**Repo:**

- UHS-CRUD; Status-Übergänge (`geplant → aktiv → aufgeloest`, ungültiger Übergang `422`).
- **Auflösung blockt** bei aktiver Belegung → `409`; **Storno blockt** ebenfalls bei
  aktiver Belegung → `409`.
- `geplant`-UHS akzeptiert keine Belegung (`422`).
- Plätze-CRUD inkl. `pos_x`/`pos_y`-Update; Platz-Soft-Delete blockt bei Belegung.
- Belegungs-Events append-only; Cache (`aktuelle_uhs_id`/`aktueller_platz_id`) konsistent
  mit jüngstem Event in derselben Tx.
- **1:1-Belegung erzwungen:** zweiter `eintritt`/`wechsel` auf belegten Platz → Konflikt
  (Unique-Index-Verletzung).
- **Inbox unbegrenzt:** mehrere Belegungen mit `platz_id = NULL` in derselben UHS sind
  gleichzeitig zulässig.

**Verfügbarkeit & Reservierung:**

- Eintritt/Wechsel auf `defekt`/`gesperrt`/`aufbereitung` → `422`.
- Reservierung erfordert Person-FK (CHECK greift; `reserviert` ohne Person → Insert-Fehler).
- Eintritt/Wechsel der reservierten Person → erlaubt; Reservierung wird gelöscht
  (`verfuegbarkeit = 'frei'`, `reserviert_fuer_person_id = NULL`).
- Eintritt einer **anderen** Person auf einen fremd-`reserviert`-Platz → `422`.
- **Auto-Aufbereitung-Asymmetrie:** Verlassen eines `frei`-Platzes → `aufbereitung`;
  Verlassen eines `defekt`-Platzes → bleibt `defekt`.
- Verfügbarkeits-Wechsel auf belegtem Platz erlaubt (informativ); Reservierung-Setzen auf
  belegtem Platz → `422`.

**Cross-Modul (Auto-Austritt):**

- E‑1-Status-Wechsel `betroffen → verstorben`: falls Person belegt, Auto-Austritt erfolgt;
  ehemaliger Platz aufbereitet (falls vorher frei); ETB hat **zwei** Einträge (Status +
  UHS-Austritt mit Notiz „durch Status-Wechsel zu verstorben").
- E‑1-Status-Wechsel `→ abgemeldet`: analog.
- E‑2-Verbleib `transport`: Auto-Austritt erfolgt; ETB-Eintrag mit Notiz „durch Verbleib transport".
- E‑2-Verbleib `entlassung`: analog.
- E‑1-Soft-Delete: aktive Belegung → Auto-Austritt; etwaige Reservierungen
  `reserviert_fuer_person_id = person.id` werden aufgelöst.

**Berechtigung:**

- Org-Isolation (fremder Einsatz → `403`/`404`).
- Nachlauffrist (nach Ablauf nur Einsatzleitung).
- Beobachter kann nicht schreiben.
- Abgeschlossener Einsatz: alle schreibenden Routen → `409` (`fordere_aktiv`).

**ETB-Leak:**

- Jeder Belegungs-Event + UHS-Lifecycle erzeugt genau einen `typ=system`-Eintrag;
  Eintragstext enthält `registrier_nr` + UHS-Bezeichnung (+ Platz, falls gesetzt) und
  **keinen** `name`/`vorname` (Leak-Test).
- Auto-Austritt schreibt einen **zusätzlichen** Eintrag (nicht den E‑1-/E‑2-Eintrag
  ersetzen).
- Verfügbarkeits-Änderungen + Material-Verortung erzeugen **keinen** ETB-Eintrag.

**HTTP:** End-to-End je Route inkl. Rechte-Matrix.

**Frontend:**

- DnD-Grundriss: Platz verschieben, Personen-Drop in Inbox/Platz, Drag zwischen Inbox/Platz,
  Klick-Austritt.
- Sidebar „Personen ohne UHS" filtert nach Cache `aktuelle_uhs_id IS NULL`.
- Verfügbarkeits-Wechsel über Kontextmenü.
- Reservierung-Flow (für Person reservieren → reservierte Person belegt → Reservierung weg).
- Material-Tab: zuordnen und lösen.
- Disabled-Zustände (Beobachter / abgeschlossen / `geplant`-UHS = kein Belegen).

## Offene Punkte / Folge-Specs

- **UHS-Templates** (Standard-Aufbauten, z. B. „BHP 50") — spätere Spec.
- **Material-an-Platz** statt nur UHS — spätere Spec, falls Use-Case auftaucht.
- **Aufnahmebereitschaft** (`offen`/`voll`) als eigener Indikator — spätere Spec.
- **T4 Lagekarte** wird `uhs.standort` ggf. um Geo-Koordinaten ergänzen und den schlanken
  Grundriss-Schema-Layer durch einen ortsbezogenen Layer ersetzen.
- **UHS-spezifische Leitung** (eigener FK statt impliziter Abschnitts-Leitung) —
  spätere Spec, falls Bedarf.
- **Listen-Lese-Audit** auf UHS bewusst weggelassen (kein sensibler Inhalt) — bei Bedarf
  nachrüstbar wie in E‑1 angedacht.
