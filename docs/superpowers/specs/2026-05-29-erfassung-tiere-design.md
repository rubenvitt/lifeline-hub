# E‑4 — Tiere

**Teilprojekt:** 3 „Erfassung" — Spec **4 von 5**. Eigener Stamm für im Einsatz
auftretende Tiere (Haustier eines Betroffenen, herrenloses Tier vor Ort, vermisstes
Tier). Schlankes Erfassungs-Modul, das das E‑1-Pattern (einsatz-scoped, Status-Maschine,
Soft-Delete, pseudonyme ETB-Spur, SSE) wiederverwendet — ohne Lese-Audit, ohne
Verbleibs-Event-Modell.

**Unterbau (wiederverwendet, nicht neu gebaut):** Rollen-/Nachlauf-Gate
(`src/einsatz/berechtigung.rs` — `darf_lesen`, `ist_schreibberechtigt`, `fordere_aktiv`,
`NACHLAUF_STUNDEN`), Personen-Entity + Statusmodell ([E‑1](2026-05-27-erfassung-personen-fundament-design.md),
`src/person/`, Migr. `0020`–`0021`) für den Halter-Bezug, pseudonymer ETB-System-Helfer
(`etb_system`), SSE-Live, Modul-Muster aus E‑1/E‑3 (`src/person/`, `src/uhs/`). „Tiere"
ist im [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) Kategorie
*Erfassung*, Status `geplant` (heute `ModulStub`).

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 3 — Erfassung".

## Worum es geht

T3 „Erfassung" erfasst die im Einsatz betroffenen Subjekte/Objekte. E‑1 hat den
Personen-Stamm angelegt, E‑2 den medizinischen Verlauf, E‑3 die interne Versorgungs-Struktur.
Diese Spec baut den **Tier-Stamm**: Tiere, die im Einsatz erfasst werden — vom Hund der
evakuierten Bewohnerin über das herrenlose Pferd auf der Weide bis zur Halter-Meldung
„meine Katze ist weg".

Drei Punkte unterscheiden Tiere strukturell von Personen und prägen das Design:

1. **Kein DSGVO-Sonderschutz.** Tier-Daten sind keine besondere Kategorie. Das aufwendige
   Lese-Audit aus E‑1 (`person_zugriff_audit`) ist hier nicht nötig — sondern wäre redundant,
   weil der einzige potentiell sensible Personenbezug (der Halter) entweder über einen
   FK auf `einsatz_person` läuft (dann ist der **Klick zur Halter-Auflösung** über E‑1
   bereits auditiert) oder bewusst als Freitext erfasst wird (`halter_kontakt`).
2. **Schlanker Lebenszyklus.** Tiere wandern nicht durch eine Sichtungskette wie Patienten.
   Drei Zustände (`aktiv | vermisst | abgeschlossen`) decken die Use-Cases ab; ein
   `abschluss_grund` + freier `abschluss_ziel` auf dem Tier-Datensatz ersetzen ein
   E‑2-artiges Verbleibs-Event-Modell.
3. **Halter ist optional und kann intern oder extern sein.** Halter-Bezug als FK XOR
   Freitext (CHECK-Constraint): wer im Einsatz erfasst ist, wird referenziert; externer
   Halter (Chip-Auslese verweist auf Privatperson zu Hause) als Freitext-Kontakt; beides
   leer = unbekannt.

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Tiere sind einsatz-scoped** — Tabelle `einsatz_tier`, kein globaler Stamm, keine
   Disposition. Identisch zum E‑1-Schnitt.
2. **Drei Use-Cases drin:** Tier eines/r Betroffenen (mit Halter-FK), herrenloses Tier
   im Einsatz, vermisstes Tier. **Draußen:** Tierkadaver ohne Erfassungsbedarf (→ E‑5
   Schäden); Massentierhaltung/Tierseuchen (eigener Use-Case, später).
3. **Schlanke Status-Maschine:** `aktiv | vermisst | abgeschlossen`. Anlegen erlaubt
   `aktiv` (Default) oder direkt `vermisst`. Übergang `→ abgeschlossen` erfordert
   `abschluss_grund` (Pflicht) + `abschluss_ziel` (Freitext, optional).
4. **Halter-Modell:** `halter_person_id INTEGER REFERENCES einsatz_person(id)` XOR
   `halter_kontakt TEXT` (Freitext Name/Telefon). CHECK-Constraint erzwingt, dass nicht
   beide gleichzeitig gesetzt sind; beides NULL = Halter unbekannt.
5. **Halter-FK bleibt bei Person-Soft-Delete bestehen** — kein Auto-Storno auf Tieren;
   UI zeigt „Halter (storniert): R-nnn". Person-Hard-Delete kann nicht passieren (E‑1).
6. **Kein Cross-Modul-Auto-Effekt:** Halter-Status-Wechsel (z. B. Person → `abgemeldet`)
   löst keinen automatischen Tier-Abschluss aus. Das Tier kann beim Tierarzt bleiben,
   während der Halter heim geht. Bewusst manuelle Aktion.
7. **Spezies als schlankes Enum + Rasse-Freitext:** `spezies ∈ {hund, katze, grosstier,
   nutzgefluegel, kleintier, wildtier, sonstige}`; `rasse_beschreibung TEXT` (Freitext für
   „Haflinger", „Deutscher Schäferhund"). „grosstier" bündelt Pferd/Rind/Schwein/Schaf
   (TGRH-relevant).
8. **Kein Lese-Audit, kein Verbleibs-Event-Modell.** Tier-Detail-Öffnung und Export werden
   nicht auditiert. Abschluss-Felder auf dem Tier-Datensatz genügen; kein E‑2-Pendant.
9. **Pseudonyme ETB-Spur** (`typ=system`) bei Anlegen / Status-Wechsel / Stornieren —
   Text enthält `registrier_nr` + Spezies + Status (+ `abschluss_grund` bei Abschluss);
   **nie** Rufname, Kennzeichnung, Halter-Bezug oder `abschluss_ziel`.
10. **SSE-Event-Typ `tier`** mit Payload nur `einsatz_id` + `tier_id`; Clients refetchen.
    Identisches Muster zu E‑1/E‑3.
11. **Cross-Modul-Sichtbarkeit (lesend):** Personen-Detail (E‑1) zeigt „Zugeordnete Tiere"
    als lesenden Chip-Block (`GET /tiere?halter_person_id=…`). Anlegen/Bearbeiten passiert
    nur im Tier-Modul.

## Scope

**Drinnen (E‑4):**

- Tier-Entity `einsatz_tier` (einsatz-scoped, Soft-Delete, Registriernummer `T-nnn`).
- Spezies-Enum + Identitäts-/Halter-Felder (FK XOR Freitext, CHECK-erzwungen).
- Status-Maschine `{aktiv, vermisst, abgeschlossen}` inkl. erlaubter Übergänge und
  Pflicht-`abschluss_grund` beim Übergang in den Endzustand.
- CRUD + Status-Wechsel + Stornieren über Routen; Org-Isolation; Rollen-/Nachlauf-Gate.
- Pseudonyme ETB-Spur (`typ=system`) bei Lifecycle-Events.
- SSE-Live (Event `tier`, ohne sensible Payload).
- Frontend-Modul „Tiere" (Kategorie *Erfassung*): Liste mit Status-/Spezies-Filter,
  Detail-Drawer, Schnellerfassung, Vermisst-Meldung.
- Lesende Cross-Modul-Erweiterung im Personen-Drawer („Zugeordnete Tiere"-Block).

**Draußen (eigene/spätere Specs):**

- **Tier-Sammelstelle / Tier-Versorgungs-Struktur** (E‑3-Pendant für Tiere) — späterer
  Bedarf, wenn Sammelpunkte/Tierarzt-vor-Ort dauerhaft strukturiert werden müssen.
- **Verbleibs-Event-Modell** (E‑2-Pendant) — falls Tiere häufig durch mehrere Stationen
  wandern und ein lückenloser Verlauf gefordert ist; Schlank-Modell mit Abschluss-Feldern
  reicht aktuell.
- **Halter-Auto-Effekte** (Tier-Auto-Abschluss bei Halter-Status-Wechsel) — bewusst
  draußen (siehe Annahme 6).
- **Tier-Sichtungs-/Verletzungsgrad-Schema** — kein BOS-Standard analog SK I–IV; in der
  Praxis Freitext-Notiz, nicht modelliert.
- **Tier als reines Schadensobjekt (Kadaver-Beseitigung)** — passt zu E‑5 Schäden.
- **Massentierhaltung / Tierseuchen** — eigener Use-Case, eigene spätere Spec.
- **Lese-Audit auf Tieren** — bewusst draußen (Annahme 8); bei Bedarf nachrüstbar wie
  in E‑1 angedacht.
- **Daten-Retention abgeschlossener Einsätze** — querschnittliche Folge-Spec; die
  pseudonyme ETB-Spur ist dafür bereits selbsttragend.

## Datenmodell

Migrations-Inventar (additiv zu E‑3, das bei `0030` endet):

| Migration | Inhalt |
|---|---|
| `0031_einsatz_tier.sql` | Tier-Entity inkl. Status-Maschine, Halter-FK/Freitext, Abschluss-Felder, Soft-Delete |

```sql
-- Migration 0031_einsatz_tier.sql
CREATE TABLE einsatz_tier (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr   INTEGER NOT NULL,          -- fortlaufend je Einsatz, server-autoritativ
    status          TEXT    NOT NULL DEFAULT 'aktiv'
                    CHECK (status IN ('aktiv','vermisst','abgeschlossen')),

    -- Spezies & Identität (alle außer spezies optional)
    spezies         TEXT    NOT NULL
                    CHECK (spezies IN ('hund','katze','grosstier','nutzgefluegel',
                                       'kleintier','wildtier','sonstige')),
    rasse_beschreibung TEXT,                   -- "Haflinger", "Deutscher Schäferhund"
    rufname         TEXT,
    geschlecht      TEXT CHECK (geschlecht IS NULL OR
                                geschlecht IN ('maennlich','weiblich','unbekannt')),
    alter_geschaetzt INTEGER,                  -- Jahre
    farbe_beschreibung TEXT,                   -- "schwarz mit weißer Brust"
    kennzeichnung   TEXT,                      -- Chip-Nr., Brandzeichen, Tätowierung, Halsband
    groesse_gewicht TEXT,                      -- "ca. 30 kg, mittelgroß"

    -- Halter (FK XOR Freitext; beides NULL = unbekannt)
    halter_person_id INTEGER REFERENCES einsatz_person(id),
    halter_kontakt  TEXT,                      -- Freitext: Name + Tel., wenn Halter nicht im Einsatz

    -- Erfassungskontext
    antreff_ort     TEXT,                      -- Freitext (analog E‑1; Tier-Sammelstelle = Folge-Spec)
    notiz           TEXT,

    -- Abschluss (gefüllt beim Übergang → abgeschlossen)
    abschluss_grund TEXT CHECK (abschluss_grund IS NULL OR abschluss_grund IN
                    ('uebergabe_halter','uebergabe_tierarzt','uebergabe_tierheim',
                     'verstorben','freilauf','sonstiges')),
    abschluss_ziel  TEXT,                      -- Freitext: "Tierarzt Müller, Hauptstr. 12"

    -- Meta / Audit
    erfasst_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von     INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von   INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at    TEXT,                      -- Soft-Delete (Fehleingabe); kein Hard-Delete

    UNIQUE (einsatz_id, registrier_nr),
    CHECK (halter_person_id IS NULL OR halter_kontakt IS NULL),
    CHECK (status <> 'abgeschlossen' OR abschluss_grund IS NOT NULL)
);

CREATE INDEX idx_einsatz_tier_einsatz ON einsatz_tier (einsatz_id, status);
CREATE INDEX idx_einsatz_tier_halter  ON einsatz_tier (halter_person_id);
```

**Registriernummer:** server-autoritativ vergeben (`MAX(registrier_nr)+1` je `einsatz_id`,
in derselben Transaktion wie das Insert — gleiches Muster wie E‑1 `R-nnn` und ETB `lfd_nr`).
Anzeige als `T-007`.

**Halter-FK-Lebenszyklus:** `halter_person_id` zeigt ggf. auf eine soft-gelöschte
(`storniert_at IS NOT NULL`) Person — der Tier-Datensatz bleibt unverändert, die UI zeigt
„Halter (storniert): R-nnn". Person-Hard-Delete kann nicht passieren (E‑1-Annahme: kein
Hard-Delete), also keine Dangling-FK-Gefahr.

## Status-Maschine

```
            anlegen (default)
                  │
                  ▼
              ┌── aktiv ──┐
   anlegen    │    ▲      │
   (vermisst) │    │      │
        │     ▼    │      ▼
        └─► vermisst ──► abgeschlossen (terminal,
                                       erfordert abschluss_grund)
```

- **Anlegen** → `aktiv` (Default) oder explizit `vermisst` (für „Vermisst melden"-Flow).
  Beide via `POST /tiere`; direktes `abgeschlossen` beim Anlegen ist nicht erlaubt
  (sinnloser Datensatz; `422`).
- `aktiv ↔ vermisst` — Tier entlaufen / wiedergefunden. Keine Zustandsverknüpfung mit
  anderen Tieren in dieser Spec (kein „Vermisstenabgleich" wie bei Personen in E‑2).
- `aktiv | vermisst → abgeschlossen` — erfordert `abschluss_grund` (per Route-Validierung
  + DB-CHECK); `abschluss_ziel` ist Freitext und je nach Grund empfohlen (Tierarzt-/
  Tierheim-Name, R-nnn des aufnehmenden Halters).
- `abgeschlossen` terminal; Korrektur zurück (Fehleingabe) nur mit Schreibrecht +
  Re-Validierung der Zielzustand-Voraussetzungen.
- Ungültiger Übergang → `422`.

Übergänge werden serverseitig validiert; der `abschluss_grund` wird beim Verlassen des
Endzustands **nicht** automatisch geleert (Audit-Spur des letzten Abschlusses bleibt im
Datensatz), kann aber via `PATCH` aktualisiert werden.

## Berechtigung & Audit

- **Lesen** (Liste + Detail + Export): bestehendes `darf_lesen` (Mitgliedschaft +
  Nachlauffrist; höhere Berechtigung org-übergreifend). **Kein `tier_zugriff_audit`** —
  Tier-Daten sind keine DSGVO-besondere Kategorie. Die Halter-Identität ist im Tier-Detail
  nur als `R-nnn`-Verweis sichtbar; das Auflösen über den Klick in den Personen-Drawer
  ist bereits über `person_zugriff_audit` (E‑1) auditiert. `halter_kontakt`-Freitext
  (externer Halter) ist bewusste Erfassung ohne zusätzlichen Schutz.
- **Schreiben** (CRUD, Status, Stornieren): `ist_schreibberechtigt` (Einsatzleitung +
  Führungspersonal); Beobachter nur lesend. **Abgeschlossener Einsatz = read-only**
  (`fordere_aktiv`).
- **Org-Isolation:** jede Query trägt das `einsatz_id`-Prädikat; Routen sind unter dem
  Einsatz-Scope montiert und prüfen Lese-/Schreibzugriff wie alle anderen Einsatz-Sub-Routen.

## ETB-Integration (pseudonym)

Anlegen / Status-Wechsel / Stornieren → je **ein** ETB-Eintrag `typ=system` über den
bestehenden `etb_system`-Helfer. Text trägt `registrier_nr` + Spezies (+ Status-Übergang
oder `abschluss_grund`), **nie** Rufname, Kennzeichnung, Halter-Bezug (weder `R-nnn`
noch `halter_kontakt`) oder `abschluss_ziel`:

| Ereignis | Beispieltext |
|---|---|
| Anlegen, Status `aktiv` | „Tier T-007 (Hund) erfasst" |
| Anlegen, Status `vermisst` | „Tier T-007 (Katze) als vermisst gemeldet" |
| `aktiv → vermisst` | „Tier T-007: aktiv → vermisst" |
| `vermisst → aktiv` | „Tier T-007: vermisst → aktiv (aufgefunden)" |
| `→ abgeschlossen` | „Tier T-007: abgeschlossen (uebergabe_tierarzt)" |
| Stornieren | „Tier T-007 storniert" |

> **Geltungsbereich der Pseudonymität:** wie E‑1 — gilt für die **automatisch**
> geschriebenen `typ=system`-Einträge. **Manuelle** ETB-Einträge sind Freitext und können
> identifizierende Texte enthalten.

ETB-Eintrag wird in **derselben Transaktion** wie der fachliche Insert geschrieben;
anschließend SSE-Event `tier`.

## Live / SSE

Ein neuer Event-Typ `tier` mit identischem Muster zu `person`/`uhs`:

- Payload nur `einsatz_id` + `tier_id` — keine sensible Payload im Stream
- Getriggert bei: Anlegen, `PATCH` (Stammfelder), Status-Wechsel, Stornieren
- Clients refetchen die betroffene Ressource

Der Personen-Drawer abonniert `tier`-Events zusätzlich, um den „Zugeordnete Tiere"-Block
live zu aktualisieren.

## Routen (API)

Alle unter `/api/einsaetze/:id/tiere`, montiert im Einsatz-Scope (Lese-/Schreib-Gate,
Org-Isolation, Nachlauffrist).

| Methode | Pfad | Zweck | Recht |
|---|---|---|---|
| `GET` | `/tiere` | Liste (Filter `?status=`, `?spezies=`, `?halter_person_id=`) | Lesen |
| `POST` | `/tiere` | Anlegen (Body: `status ∈ {aktiv, vermisst}`); Registriernr vergeben | Schreiben |
| `GET` | `/tiere/:tid` | Detail (voller Datensatz) | Lesen |
| `PATCH` | `/tiere/:tid` | Stammfelder (Identität, Halter, Antreffort, Notiz) | Schreiben |
| `POST` | `/tiere/:tid/status` | Status-Wechsel; bei `→ abgeschlossen` mit `abschluss_grund` (Pflicht) + `abschluss_ziel` (optional) | Schreiben |
| `DELETE` | `/tiere/:tid` | Stornieren (Soft-Delete) | Schreiben |
| `GET` | `/tiere/export` | Export (CSV) | Lesen |

**Validierungen / Fehler:**

- `POST /tiere` mit `status = 'abgeschlossen'` → `422`.
- Halter-Exklusivität: `POST`/`PATCH` mit beiden Halter-Feldern gesetzt → `422` (zusätzlich
  zum DB-CHECK als zweite Verteidigungslinie).
- `POST /tiere/:tid/status` mit ungültigem Übergang → `422`; `→ abgeschlossen` ohne
  `abschluss_grund` → `422`.
- `PATCH` auf storniertem Tier → `409`; `DELETE` auf bereits storniertem Tier → `409`.

Status-Wechsel / Anlegen / Stornieren schreiben in derselben Transaktion die pseudonyme
ETB-Spur und lösen das SSE-Event aus.

## Frontend

Modul „Tiere" (Kategorie *Erfassung*), ersetzt den `ModulStub` (neuer `modulRegistry`-Eintrag
`tiere`). Struktur und Komponenten analog `PersonenPage` / `EinheitenPage`.

- **Liste (`TierePage`):**
  - Status-Tabs/Filter: **Aktiv** (Default) · Vermisst · Abgeschlossen · Alle.
  - Spezies-Filter (Chips/Select): Hund · Katze · Großtier · Nutzgeflügel · Kleintier ·
    Wildtier · Sonstige.
  - Spalten: Registriernr (`T-007`), Status-Badge, Spezies (Icon + Label), Rufname oder
    „—", Rasse (Kurzform), Halter-Anzeige (`R-nnn`-Chip mit Klick → Personen-Drawer · oder
    Freitext-Kurzform · oder „unbekannt"), Antreffort-Kurzform.
  - Default-Sortierung: `registrier_nr DESC` (neueste oben).
- **Schnellerfassung** (Button → Drawer): Pflicht nur Spezies, optional Rufname/
  Beschreibung/Antreffort. Setzt `status = aktiv`. Auf Masse ausgelegt.
- **„Vermisst melden"** als zweiter Anlege-Flow: setzt direkt `vermisst` und priorisiert
  Halter-Felder + Beschreibungs-Felder im Formular.
- **Detail-Drawer:**
  - Voller Datensatz; Abschluss-Block sichtbar nur bei `abgeschlossen`.
  - Halter-Block rendert `halter_person_id` als klickbaren `R-nnn`-Chip (öffnet
    Personen-Drawer — auditierter Pfad). `halter_kontakt`-Freitext direkt sichtbar. Wechsel
    FK ↔ Freitext über Toggle im Bearbeiten-Modus (exklusiv).
  - Aktionen: **Status-Wechsel** (Buttons je nach aktuellem Status: „Als vermisst markieren"
    · „Aufgefunden" · „Abschließen" mit Modal für `abschluss_grund` + `abschluss_ziel`),
    **Bearbeiten**, **Stornieren**.
  - Schreibaktionen für Beobachter / abgeschlossenen Einsatz / storniert → disabled
    (Muster K&M/E‑1).
- **Cross-Modul-Anzeige im Personen-Drawer (E‑1, lesend):** neuer Block „Zugeordnete Tiere"
  zeigt alle Tiere mit `halter_person_id = person.id` (Fetch via
  `GET /tiere?halter_person_id=…`). Liste aus Chips (`T-007 Hund "Rex"`); Klick öffnet den
  Tier-Drawer. Read-only — Anlegen/Bearbeiten passiert nur im Tier-Modul.
- **SSE-Wiring:** `useTierStream`-Hook analog `usePersonStream` (Refetch bei `tier`-Event
  mit passender `einsatz_id`); Personen-Drawer hört zusätzlich auf `tier`-Events für den
  „Zugeordnete Tiere"-Block.

## Tests

**Repo (`src/tier/`):**

- CRUD; Registriernr fortlaufend + lückenlos je Einsatz; Status-Übergänge (gültige erlaubt,
  ungültige `422`).
- Anlegen mit `status ∈ {aktiv, vermisst}`; mit `abgeschlossen` → `422`.
- `→ abgeschlossen` ohne `abschluss_grund` → `422` (Route + DB-CHECK doppelt abgesichert).
- Halter-Exklusivität: beide Felder gesetzt → `422` (Route) + Insert-Fehler (DB-CHECK).
- Soft-Delete blendet aus Default-Liste aus, bleibt referenzierbar; doppeltes Stornieren
  → `409`.
- Halter-FK auf soft-gelöschte Person bleibt zulässig (Tier-Datensatz unverändert).

**Berechtigung:**

- Org-Isolation (fremder Einsatz → `403`/`404`); Test je Route.
- Nachlauffrist (nach Ablauf nur Einsatzleitung).
- Beobachter kann nicht schreiben.
- Abgeschlossener Einsatz: alle schreibenden Routen → `409` (`fordere_aktiv`).

**ETB-Leak:**

- Jeder Lifecycle-Event (Anlegen / Status / Stornieren) erzeugt genau einen
  `typ=system`-Eintrag.
- Eintragstext enthält `registrier_nr` + Spezies (+ Status-Übergang oder `abschluss_grund`);
  **kein** `rufname`, **kein** `kennzeichnung`, **kein** Halter-Bezug (weder `R-nnn` noch
  `halter_kontakt`), **kein** `abschluss_ziel` — eigener Leak-Test pro Pfad.

**HTTP:** End-to-End je Route inkl. Rechte-Matrix (Muster aus `tests/`).

**Frontend (`TierePage.test.tsx`):**

- Liste/Filter (Status-Tabs, Spezies-Filter), Anlege-Flows (Schnellerfassung / Vermisst-Meldung),
  Halter-Toggle FK ↔ Freitext, Status-Wechsel-Modals (insbesondere Abschluss-Grund-Pflicht),
  disabled-Zustände.
- Personen-Drawer-Erweiterung: „Zugeordnete Tiere"-Block fetcht und rendert; reagiert auf
  `tier`-SSE-Events.

## Offene Punkte / Folge-Specs

- **Tier-Sammelstelle / Tier-Versorgungs-Struktur** (E‑3-Pendant für Tiere) — späterer
  Bedarf, wenn Sammelpunkte/Tierarzt-vor-Ort dauerhaft strukturiert werden müssen.
- **Verbleibs-Event-Modell** (E‑2-Pendant) — falls Tiere häufig durch mehrere Stationen
  wandern und Verlauf gefordert ist; Schlankmodell mit Abschluss-Feldern genügt aktuell.
- **Halter-Auto-Effekte** (Tier-Auto-Abschluss bei Halter-Status-Wechsel) — bewusst draußen
  (Annahme 6); bei Bedarf eigene spätere Spec.
- **Tier-Sichtungs-/Verletzungsgrad-Schema** — kein BOS-Standard analog SK I–IV; aktuell
  Freitext-Notiz.
- **Tier als Schadensobjekt (Kadaver-Beseitigung)** — passt zu E‑5 Schäden.
- **Massentierhaltung / Tierseuchen** — eigener Use-Case, eigene spätere Spec.
- **Lese-Audit auf Tieren** — bewusst draußen (Annahme 8); bei Bedarf nachrüstbar wie in
  E‑1 angedacht.
- **Daten-Retention abgeschlossener Einsätze** — querschnittliche Folge-Spec; pseudonyme
  ETB-Spur ist bereits selbsttragend.
