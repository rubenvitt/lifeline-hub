# E‑5 — Schäden

**Teilprojekt:** 3 „Erfassung" — Spec **5 von 5**. Schadensobjekte/-stellen
(Sach-/Infrastruktur-/Umweltschäden inkl. Tierkadaver + Verkehrshindernisse) als
einsatz-scoped Entity mit Bearbeitungs-Workflow. Schlankes Modul, das das E‑1/E‑4-Pattern
(einsatz-scoped, Status-Maschine, Soft-Delete, pseudonyme ETB-Spur, SSE) wiederverwendet —
mit einem zusätzlichen Übergabe-Zwischenstand für die Aufgaben-Steuerung.

**Unterbau (wiederverwendet, nicht neu gebaut):** Rollen-/Nachlauf-Gate
(`src/einsatz/berechtigung.rs` — `darf_lesen`, `ist_schreibberechtigt`, `fordere_aktiv`,
`NACHLAUF_STUNDEN`), Personen-Entity + Statusmodell ([E‑1](2026-05-27-erfassung-personen-fundament-design.md),
`src/person/`, Migr. `0020`–`0021`) für den Geschädigt-Bezug, pseudonymer ETB-System-Helfer
(`etb_system`), SSE-Live, Modul-Muster aus E‑1/E‑3/E‑4 (`src/person/`, `src/uhs/`, `src/tier/`).
„Schäden" ist im [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) Kategorie
*Erfassung*, Status `geplant` (heute `ModulStub`).

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 3 — Erfassung".

## Worum es geht

T3 „Erfassung" erfasst die im Einsatz betroffenen Subjekte/Objekte. E‑1 hat den
Personen-Stamm angelegt, E‑2 den medizinischen Verlauf, E‑3 die interne Versorgungs-Struktur,
E‑4 den Tier-Stamm. Diese Spec schließt T3 ab: **Schäden** als
eigene Entität für alles, was im Einsatz an Sachwerten, Infrastruktur oder Umwelt betroffen
ist und entweder einen Behebungsauftrag erzeugt, an externe Stellen übergeben wird oder
zumindest für Lagebild und Nachweis dokumentiert sein muss.

Drei Punkte unterscheiden Schäden strukturell von den anderen E-*-Entitäten und prägen
das Design:

1. **Schaden ist Arbeitsauftrag, nicht nur Stamm.** Im Gegensatz zu Personen/Tieren hat
   ein Schaden einen Bearbeitungs-Fortschritt (`offen → uebergeben → abgeschlossen`).
   Der Übergabe-Zwischenstand ist eigenständig — „nicht mehr in unserer Hand, aber noch
   nicht behoben" ist eine echte Lagebild-Information.
2. **Drei Zwecke in einem Datensatz.** Erfassung dient gleichzeitig Lagebild („wir wissen
   davon"), Aufgaben-Steuerung („was steht offen, an wen wurde übergeben") und Nachweis
   („was wurde wo beschädigt, in welchem Ausmaß"). Das Datenmodell muss alle drei tragen,
   ohne zu schwer zu werden.
3. **Geschädigter ist optional und kann intern oder extern sein.** Symmetrisch zum
   E‑4-Halter-Modell: wer im Einsatz erfasst ist, wird referenziert; externer Eigentümer
   (Hausbesitzer, der nicht vor Ort ist) als Freitext-Kontakt; beides leer = unbekannt
   oder irrelevant (Verkehrshindernis auf öffentlichem Grund).

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Schäden sind einsatz-scoped** — Tabelle `einsatz_schaden`, kein globaler Stamm, keine
   Disposition. Identisch zum E‑1/E‑4-Schnitt.
2. **Eine Entität pro Schaden.** Sturm beschädigt 5 Häuser = 5 Datensätze, nicht ein
   Ereignis mit 5 Stellen. Jeder Schaden hat eigenen Status + eigene Übergabe —
   konsistent mit Aufgaben-Steuerung als Zweck. „Schadensobjekte/-stellen" in PROGRESS
   ist Synonym, nicht zwei Entitäten.
3. **Flacher Typ-Enum + Sonstige-Fallback:** `typ ∈ {sachschaden, verkehrshindernis,
   infrastruktur, umweltschaden, tierkadaver, sonstige}`. Mehrfach-Tagging und
   Hierarchien bewusst draußen (führt zu Sammelposten, die im Workflow nicht
   funktionieren). Tierkadaver ist eigener Typ-Wert — kein FK auf `einsatz_tier`
   (siehe Annahme 7).
4. **Ausmaß-Enum Pflicht + freie Beschreibung optional:** `ausmass ∈ {gering, mittel,
   gross, katastrophal}` (PFLICHT) + editierbare `beschreibung TEXT` (DEFAULT `''`).
   Ausmaß erlaubt Filter/Statistik für Lagebild + Bilanz; Beschreibung trägt Detail
   für Nachweis.
5. **Ort als Freitext.** `ort TEXT` (PFLICHT) — „L 235 km 12,5", „Hauptstr. 17",
   „Wald hinter Müllers Hof". **Keine** strukturierte Anschrift, **keine**
   Geo-Koordinaten in dieser Spec. Koordinaten + Karten-Rendering kommen in
   T4 Lagekarte; hier nur die Vorbereitung als ablösbares Freitext-Feld.
6. **Geschädigt-Modell:** `geschaedigt_person_id INTEGER REFERENCES einsatz_person(id)`
   XOR `geschaedigt_kontakt TEXT` (Freitext Name/Telefon). CHECK-Constraint erzwingt,
   dass nicht beide gleichzeitig gesetzt sind; beides NULL = unbekannt/öffentlich.
   Verhalten bei Person-Soft-Delete identisch zu E‑4-Halter: FK bleibt, UI zeigt
   „Geschädigt (storniert): R-nnn".
7. **Kein FK auf einsatz_tier bei tierkadaver.** Der typische Kadaver-Fall (E‑4 explizit:
   „Tierkadaver ohne Erfassungsbedarf → E‑5 Schäden") ist ein nicht in E‑4 erfasstes
   Tier. Der seltene Verbund (in E‑4 erfasstes Tier verstirbt, muss als Kadaver entsorgt
   werden) wird via Freitext in `beschreibung` abgedeckt. YAGNI, bei Bedarf später
   nachrüstbar.
8. **Status-Maschine `offen → uebergeben → abgeschlossen`** + Soft-Delete. Übergeben
   verlangt `uebergeben_an` (Freitext, Pflicht); Abschluss verlangt `abschluss_grund`
   (Enum, Pflicht). Sprung `offen → abgeschlossen` ist erlaubt (intern erledigt ohne
   Übergabe). Rückwärts-Übergänge sind nicht erlaubt; Fehleingaben werden storniert.
9. **Übergabe-Adressat als Freitext.** `uebergeben_an TEXT`. BOS-Praxis: Übergabe geht
   fast immer an externe Stellen (Bauhof, Stadtwerke, Umweltamt, Versicherung,
   Eigentümer), die nicht im System sind. FK-Modellierung wäre vorgreifender Overhead.
10. **Kein Lese-Audit, kein Verbleibs-Event-Modell.** Schaden-Daten sind keine
    DSGVO-besondere Kategorie. Der einzige potentiell sensible Personenbezug
    (Geschädigter) läuft entweder über einen FK auf `einsatz_person` (dann ist der Klick
    zur Person-Auflösung über E‑1 `person_zugriff_audit` bereits auditiert) oder als
    bewusster Freitext-Kontakt. Status-Verlauf liefert die pseudonyme ETB-Spur.
11. **Pseudonyme ETB-Spur** (`typ=system`) bei Anlegen / Status-Wechsel / Stornieren —
    Text enthält `registrier_nr` + Typ + Ausmaß + Status-Übergang (+ `uebergeben_an`
    bei Übergabe; `abschluss_grund` bei Abschluss; `ort`-Kurzform). **Nie**
    Geschädigt-Bezug, **nie** freie `beschreibung`. Abweichung von E‑4-Strenge bewusst:
    bei Schäden ist der Ort fachlich essentiell für das Lagebild — und keine
    DSGVO-besondere Kategorie an sich.
12. **SSE-Event-Typ `schaden`** mit Payload nur `einsatz_id` + `schaden_id`; Clients
    refetchen. Identisches Muster zu E‑1/E‑3/E‑4.
13. **Cross-Modul-Sichtbarkeit (lesend):** Personen-Detail (E‑1) zeigt „Als Geschädigte
    bei Schäden" als lesenden Chip-Block (`GET /schaeden?geschaedigt_person_id=…`).
    Tier-Detail (E‑4) bleibt unverändert — kein FK von Schaden auf Tier (Annahme 7).
14. **Storno blockiert nicht.** Anders als E‑3-UHS-Auflösung gibt es keine inhaltliche
    „Belegung", die ein Storno als Fehleingabe entlarvt. Storno ist immer möglich.

## Scope

**Drinnen (E‑5):**

- Schaden-Entity `einsatz_schaden` (einsatz-scoped, Soft-Delete, Registriernr `S-nnn`).
- Typ-Enum (6 Werte) + Ausmaß-Enum (4 Werte, Pflicht) + Mehrspalten-CHECKs für
  Status-Pflichtfelder und Geschädigt-XOR.
- Status-Maschine `{offen, uebergeben, abgeschlossen}` inkl. erlaubter Übergänge,
  Pflicht-`uebergeben_an` bei Übergabe und Pflicht-`abschluss_grund` bei Abschluss.
- CRUD + Status-Aktionen (`uebergeben`, `abschliessen`) + Stornieren über Routen;
  Org-Isolation; Rollen-/Nachlauf-Gate.
- Geschädigt-Modell FK XOR Freitext (CHECK-erzwungen), nullbar beides.
- Pseudonyme ETB-Spur (`typ=system`) bei Lifecycle-Events.
- SSE-Live (Event `schaden`, ohne sensible Payload).
- Frontend-Modul „Schäden" (Kategorie *Erfassung*): Liste mit Status-/Typ-/Ausmaß-Filter,
  Detail-Drawer, Schnellerfassung, Übergabe- und Abschluss-Aktionen.
- Lesende Cross-Modul-Erweiterung im Personen-Drawer („Als Geschädigte bei Schäden"-Block).

**Draußen (eigene/spätere Specs):**

- **Geo-Koordinaten + Karten-Rendering** → T4 Lagekarte. ClickUp-Folge-Task:
  „Schäden → Geo-Koordinaten nachziehen, sobald T4 läuft".
- **Foto-/Datei-Anhänge** — kein Anhang-System in T1; querschnittliches Thema, eigene
  spätere Spec (vermutlich gemeinsam für Personen/Tiere/Schäden/UHS).
- **Gefahren-/Absperrzonen** → Lage (PROGRESS-Vorgabe).
- **Append-only Notizen-Verlauf** (E‑2-Pendant) — ETB liefert den unveränderlichen
  Verlauf; bei Bedarf später nachrüstbar.
- **Lese-Audit auf Schäden** — bewusst draußen (Annahme 10); analog E‑4. Bei Bedarf
  nachrüstbar wie in E‑1 angedacht.
- **FK auf einsatz_tier bei typ='tierkadaver'** — bewusst draußen (Annahme 7).
- **Mehrere Geschädigte pro Schaden (1:n)** — 1:1 reicht für die Praxis; Reihenhaus-Fall
  wird mehrfach angelegt oder Freitext.
- **Abschnitts-Zuordnung (`abschnitt_id`)** — kein aktueller Use-Case; bei Bedarf
  nachrüstbar (UHS-Pattern).
- **Hierarchische Schadens-Taxonomie / Mehrfach-Tags** — bewusst flacher Enum (Annahme 3).
- **Rückwärts-Übergänge der Status-Maschine** — Fehleingaben werden storniert, nicht
  zurückgerollt.
- **Massendaten-Import / -Export** — kein aktueller Bedarf; CSV-Export könnte symmetrisch
  zu E‑4 später ergänzt werden.
- **Daten-Retention abgeschlossener Einsätze** — querschnittliche Folge-Spec; die
  pseudonyme ETB-Spur ist dafür bereits selbsttragend.

## Datenmodell

Migrations-Inventar (additiv zu E‑4, das bei `0031` endet):

| Migration | Inhalt |
|---|---|
| `0032_einsatz_schaden.sql` | Schaden-Entity inkl. Status-Maschine, Geschädigt-FK/Freitext, Übergabe-/Abschluss-Felder, Soft-Delete |

```sql
-- Migration 0032_einsatz_schaden.sql
CREATE TABLE einsatz_schaden (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id               INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr            INTEGER NOT NULL,                  -- fortlaufend je Einsatz, server-autoritativ
    status                   TEXT    NOT NULL DEFAULT 'offen'
                             CHECK (status IN ('offen','uebergeben','abgeschlossen')),

    -- Klassifikation
    typ                      TEXT    NOT NULL
                             CHECK (typ IN ('sachschaden','verkehrshindernis','infrastruktur',
                                            'umweltschaden','tierkadaver','sonstige')),
    ausmass                  TEXT    NOT NULL
                             CHECK (ausmass IN ('gering','mittel','gross','katastrophal')),

    -- Ort + Beschreibung
    ort                      TEXT    NOT NULL,                  -- Freitext; Koordinaten → T4
    beschreibung             TEXT    NOT NULL DEFAULT '',       -- editierbar; Verlauf liefert ETB

    -- Geschädigter (FK XOR Freitext; beides NULL = unbekannt/öffentlich)
    geschaedigt_person_id    INTEGER REFERENCES einsatz_person(id),
    geschaedigt_kontakt      TEXT,

    -- Übergabe (gefüllt beim Übergang → uebergeben)
    uebergeben_an            TEXT,                              -- Freitext-Adressat (Bauhof, Stadtwerke, …)
    uebergeben_at            TEXT,                              -- ISO-Zeit beim Übergang

    -- Abschluss (gefüllt beim Übergang → abgeschlossen)
    abschluss_grund          TEXT
                             CHECK (abschluss_grund IS NULL OR abschluss_grund IN
                                    ('behoben','kein_handlungsbedarf','abgewiesen')),
    abschluss_at             TEXT,

    -- Meta / Audit
    erfasst_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von              INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von            INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at             TEXT,                              -- Soft-Delete (Fehleingabe); kein Hard-Delete
    storniert_von            INTEGER REFERENCES benutzer(id),

    UNIQUE (einsatz_id, registrier_nr),

    -- Geschädigt FK XOR Freitext
    CHECK (geschaedigt_person_id IS NULL OR geschaedigt_kontakt IS NULL),

    -- Status-Pflichtfelder (Effektivzustand)
    CHECK (status <> 'uebergeben'    OR uebergeben_an   IS NOT NULL),
    CHECK (status <> 'abgeschlossen' OR abschluss_grund IS NOT NULL)
);

CREATE INDEX idx_einsatz_schaden_einsatz      ON einsatz_schaden (einsatz_id, status);
CREATE INDEX idx_einsatz_schaden_geschaedigt  ON einsatz_schaden (geschaedigt_person_id)
    WHERE geschaedigt_person_id IS NOT NULL;
CREATE INDEX idx_einsatz_schaden_offen        ON einsatz_schaden (einsatz_id)
    WHERE status <> 'abgeschlossen' AND storniert_at IS NULL;
```

**Registriernummer:** server-autoritativ vergeben (`MAX(registrier_nr)+1` je `einsatz_id`,
in derselben Transaktion wie das Insert — gleiches Muster wie E‑1 `R-nnn`, E‑4 `T-nnn`
und ETB `lfd_nr`). Anzeige als `S-007`.

**Geschädigt-FK-Lebenszyklus:** `geschaedigt_person_id` darf auf eine soft-gelöschte
(`storniert_at IS NOT NULL`) Person zeigen — der Schaden-Datensatz bleibt unverändert,
die UI zeigt „Geschädigt (storniert): R-nnn". Person-Hard-Delete kann nicht passieren
(E‑1-Annahme), keine Dangling-FK-Gefahr. Konsistent zum E‑4-Halter-Verhalten.

**PATCH-Validierung am Effektivzustand:** Mehrspalten-CHECKs (`status` + Pflichtfeld)
greifen erst, wenn der Effektivzustand nach dem PATCH geprüft wird. Der Handler muss
gegen den Bestandswert mergen und 422 zurückliefern (sonst 500 durch DB-CHECK). Pattern
aus dem Tier-Halter-Fix (`PATCH-XOR-Effektivzustand`).

## Status-Maschine

```
   ┌─────────┐ uebergeben(uebergeben_an)        ┌────────────┐
   │  offen  │ ───────────────────────────────▶ │ uebergeben │
   └────┬────┘                                  └─────┬──────┘
        │                                             │
        │ abschliessen(abschluss_grund)               │ abschliessen(abschluss_grund)
        ▼                                             ▼
                       ┌──────────────────┐
                       │  abgeschlossen   │  (terminal)
                       └──────────────────┘

   Aus jedem Zustand:  storno  →  storniert_at gesetzt (Soft-Delete)
```

- **Anlegen** → `offen` (Default). Direktes Anlegen mit `uebergeben` oder `abgeschlossen`
  ist nicht erlaubt — sinnloser Datensatz; `422`. (Ein in einem Schritt erledigter
  Schaden wird angelegt und sofort über `/abschliessen` geschlossen — zwei Klicks, klare
  Spur im ETB.)
- `offen → uebergeben` — erfordert `uebergeben_an` (per Route-Validierung + DB-CHECK).
  Setzt `uebergeben_at = now()`.
- `offen | uebergeben → abgeschlossen` — erfordert `abschluss_grund` (per Route-Validierung
  + DB-CHECK); optionale `notiz` wird an die `beschreibung` angehängt (mit Zeitstempel).
  Setzt `abschluss_at = now()`.
- **Rückwärts-Übergänge** (`uebergeben → offen`, `abgeschlossen → *`) nicht erlaubt —
  Fehleingabe wird storniert + neu angelegt. Konsistent zu E‑4.
- `abgeschlossen` terminal.
- **Storno** aus jedem Zustand möglich; setzt `storniert_at = now()`, `storniert_von =
  user`. Anders als E‑3-UHS-Auflösung **keine** Blockade bei Inhalt — ein Schaden hat
  keine „Belegung", die ihn als Fehleingabe entlarvt.

Übergänge werden serverseitig validiert; `uebergeben_an` und `abschluss_grund` werden
beim Verlassen des jeweiligen Zustands **nicht** automatisch geleert (Audit-Spur
bleibt im Datensatz).

## Berechtigung & Audit

- **Lesen** (Liste + Detail): bestehendes `darf_lesen` (Mitgliedschaft + Nachlauffrist;
  höhere Berechtigung org-übergreifend). **Kein `schaden_zugriff_audit`** — Schaden-Daten
  sind keine DSGVO-besondere Kategorie. Die Geschädigt-Identität ist im Schaden-Detail
  nur als `R-nnn`-Verweis sichtbar; das Auflösen über den Klick in den Personen-Drawer
  ist bereits über `person_zugriff_audit` (E‑1) auditiert. `geschaedigt_kontakt`-Freitext
  ist bewusste Erfassung ohne zusätzlichen Schutz.
- **Schreiben** (CRUD, Status-Aktionen, Stornieren): `ist_schreibberechtigt`
  (Einsatzleitung + Führungspersonal); Beobachter nur lesend. **Abgeschlossener Einsatz =
  read-only** (`fordere_aktiv`).
- **Org-Isolation:** jede Query trägt das `einsatz_id`-Prädikat; Routen sind unter dem
  Einsatz-Scope montiert und prüfen Lese-/Schreibzugriff wie alle anderen
  Einsatz-Sub-Routen. **Achtung:** die mögliche Cross-Org-Lesezugriff-Lücke über
  `ist_hoehere_berechtigung` (siehe Memory-Eintrag) gilt hier wie überall — Tests
  müssen das explizit abdecken.

## ETB-Integration (pseudonym)

Anlegen / Status-Wechsel / Stornieren → je **ein** ETB-Eintrag `typ=system` über den
bestehenden `etb_system`-Helfer. Text trägt `registrier_nr` + Typ + Ausmaß + Ort-Kurzform
(+ Status-Übergang + `uebergeben_an` bei Übergabe / `abschluss_grund` bei Abschluss),
**nie** Geschädigt-Bezug (weder `R-nnn` noch `geschaedigt_kontakt`), **nie** freie
`beschreibung`:

| Ereignis | Beispieltext |
|---|---|
| Anlegen | „Schaden S-007 angelegt: umweltschaden (gross) — *Hauptstr. 17*" |
| `offen → uebergeben` | „Schaden S-007 übergeben an *Stadtwerke*" |
| `offen → abgeschlossen` | „Schaden S-007 abgeschlossen (behoben)" |
| `uebergeben → abgeschlossen` | „Schaden S-007 abgeschlossen (behoben)" |
| Stornieren | „Schaden S-007 storniert" |

> **Bewusste Abweichung von E‑4-Strenge:** in E‑4 trägt der ETB nur Reg-Nr + Spezies.
> Bei Schäden ist der **Ort** fachlich essentiell für das Lagebild („wir wissen, dass
> in der Hauptstraße was ist"). Der Ort selbst ist BOS-Sach-Info, keine
> DSGVO-besondere Kategorie. Wer den ETB-Eintrag lesen darf, darf auch den
> Schaden-Detail lesen — keine Eskalation des Pfads.

> **Geltungsbereich der Pseudonymität:** gilt für die **automatisch** geschriebenen
> `typ=system`-Einträge. **Manuelle** ETB-Einträge sind Freitext und können
> identifizierende Texte enthalten.

ETB-Eintrag wird in **derselben Transaktion** wie der fachliche Insert/Update
geschrieben; anschließend SSE-Event `schaden`.

## Live / SSE

Ein neuer Event-Typ `schaden` mit identischem Muster zu `person`/`uhs`/`tier`:

- Payload nur `einsatz_id` + `schaden_id` — keine sensible Payload im Stream
- Getriggert bei: Anlegen, `PATCH` (Stammfelder), Status-Wechsel, Stornieren
- Clients refetchen die betroffene Ressource

Der Personen-Drawer abonniert `schaden`-Events zusätzlich, um den „Als Geschädigte
bei Schäden"-Block live zu aktualisieren.

## Routen (API)

Alle unter `/api/einsaetze/:id/schaeden`, montiert im Einsatz-Scope (Lese-/Schreib-Gate,
Org-Isolation, Nachlauffrist).

| Methode | Pfad | Zweck | Recht |
|---|---|---|---|
| `GET` | `/schaeden` | Liste (Filter `?status=`, `?typ=`, `?ausmass=`, `?geschaedigt_person_id=`, `?inkl_storniert=`) | Lesen |
| `POST` | `/schaeden` | Anlegen (Body: alle Stammfelder; Status implizit `offen`) | Schreiben |
| `GET` | `/schaeden/:sid` | Detail (voller Datensatz) | Lesen |
| `PATCH` | `/schaeden/:sid` | Stammfelder (typ, ort, ausmass, beschreibung, Geschädigt-XOR) — **nicht** Status | Schreiben |
| `POST` | `/schaeden/:sid/uebergeben` | Status-Wechsel; Body `{uebergeben_an}` (Pflicht) | Schreiben |
| `POST` | `/schaeden/:sid/abschliessen` | Status-Wechsel; Body `{abschluss_grund, notiz?}` (Grund Pflicht; Notiz wird an `beschreibung` angehängt) | Schreiben |
| `DELETE` | `/schaeden/:sid` | Stornieren (Soft-Delete) | Schreiben |

**Validierungen / Fehler:**

- `POST /schaeden` mit `status ≠ 'offen'` → `422`.
- `POST /schaeden` ohne `typ`/`ort`/`ausmass` → `422`.
- Geschädigt-Exklusivität: `POST`/`PATCH` mit beiden Geschädigt-Feldern gesetzt → `422`
  (zusätzlich zum DB-CHECK als zweite Verteidigungslinie).
- `POST /schaeden/:sid/uebergeben` aus `uebergeben` oder `abgeschlossen` → `409`.
- `POST /schaeden/:sid/uebergeben` ohne `uebergeben_an` → `422`.
- `POST /schaeden/:sid/abschliessen` aus `abgeschlossen` → `409`.
- `POST /schaeden/:sid/abschliessen` ohne `abschluss_grund` → `422`.
- `PATCH` auf storniertem Schaden → `409`; `DELETE` auf bereits storniertem Schaden → `409`.
- **PATCH gegen Effektivzustand:** `PATCH`, der `uebergeben_an` auf NULL setzt, während
  `status='uebergeben'` bleibt, muss serverseitig `422` liefern (sonst DB-500 durch CHECK).

Status-Aktionen / Anlegen / Stornieren schreiben in derselben Transaktion die pseudonyme
ETB-Spur und lösen das SSE-Event aus.

## Frontend

Modul „Schäden" (Kategorie *Erfassung*), ersetzt den `ModulStub` (neuer `modulRegistry`-Eintrag
`schaeden`). Struktur und Komponenten analog `PersonenPage` / `TierePage`.

- **Liste (`SchaedenPage`):**
  - Status-Tabs/Filter: **Offen** (Default) · Übergeben · Abgeschlossen · Alle.
  - Typ-Filter (Chips/Select): Sachschaden · Verkehrshindernis · Infrastruktur ·
    Umweltschaden · Tierkadaver · Sonstige.
  - Ausmaß-Filter (Chips): Gering · Mittel · Groß · Katastrophal.
  - Volltext über `ort` + `beschreibung`.
  - Spalten: Registriernr (`S-007`), Typ-Badge, Ausmaß-Badge, Ort-Kurzform,
    Status-Tag (mit `uebergeben_an` in Klammern bei `uebergeben`), Geschädigt-Anzeige
    (`R-nnn`-Chip mit Klick → Personen-Drawer · oder Freitext-Kurzform · oder „—").
  - Default-Sortierung: `registrier_nr DESC` (neueste oben).
- **Schnellerfassung** (Button → Drawer): Pflicht nur Typ + Ort + Ausmaß; alles weitere
  optional. Setzt `status = offen`. Auf Masse ausgelegt.
- **Detail-Drawer:**
  - Voller Datensatz; Übergabe-Block sichtbar ab `uebergeben`; Abschluss-Block sichtbar
    ab `abgeschlossen`.
  - Geschädigt-Block rendert `geschaedigt_person_id` als klickbaren `R-nnn`-Chip
    (öffnet Personen-Drawer — auditierter Pfad). `geschaedigt_kontakt`-Freitext direkt
    sichtbar. Wechsel FK ↔ Freitext über Toggle im Bearbeiten-Modus (exklusiv) —
    Komponente vom E‑4-`HalterPicker` ableiten / wiederverwendbar machen.
  - Aktionen: **„Übergeben"** (Modal für `uebergeben_an`) · **„Abschließen"**
    (Modal für `abschluss_grund` + optional `notiz`) · **Bearbeiten** · **Stornieren**
    (im Overflow).
  - Aktions-Buttons werden je nach aktuellem Status (de)aktiviert: aus `offen` beides
    möglich; aus `uebergeben` nur Abschließen; aus `abgeschlossen` keine Status-Aktion
    mehr. Schreibaktionen für Beobachter / abgeschlossenen Einsatz / storniert → disabled
    (Muster K&M/E‑1).
  - Status-Verlauf wird aus den ETB-Einträgen mit Filter auf Schaden-Reg-Nr gelesen
    (ETB-Suche kann das schon).
- **Cross-Modul-Anzeige im Personen-Drawer (E‑1, lesend):** neuer Block „Als Geschädigte
  bei Schäden" zeigt alle Schäden mit `geschaedigt_person_id = person.id` (Fetch via
  `GET /schaeden?geschaedigt_person_id=…&inkl_storniert=false`). Liste aus Chips
  (`S-007 umweltschaden (gross) — offen`); Klick öffnet den Schaden-Drawer. Read-only —
  Anlegen/Bearbeiten passiert nur im Schaden-Modul. Pattern aus E‑4 „Zugeordnete Tiere".
- **SSE-Wiring:** `useSchadenStream`-Hook analog `useTierStream` (Refetch bei
  `schaden`-Event mit passender `einsatz_id`); Personen-Drawer hört zusätzlich auf
  `schaden`-Events für den „Als Geschädigte bei Schäden"-Block.
- **Default-Einstieg / Kompaktnavigation:** Erstrouting in `/schaeden` ohne
  Pflicht-Vorauswahl, konsistent mit dem UHS-/Tier-/Personen-Pattern.

## Tests

**Repo (`src/schaden/`):**

- CRUD; Registriernr fortlaufend + lückenlos je Einsatz; Status-Übergänge (gültige
  erlaubt, ungültige `409`).
- Anlegen mit `status ≠ 'offen'` → `422`.
- `uebergeben` ohne `uebergeben_an` → `422` (Route + DB-CHECK doppelt abgesichert).
- `abschliessen` ohne `abschluss_grund` → `422` (Route + DB-CHECK).
- Geschädigt-Exklusivität: beide Felder gesetzt → `422` (Route) + Insert-Fehler (DB-CHECK).
- **PATCH gegen Effektivzustand:** PATCH löscht `uebergeben_an` bei `status='uebergeben'`
  → `422`, keine 500 (Lehre aus dem Tier-Halter-Fix).
- Soft-Delete blendet aus Default-Liste aus, bleibt referenzierbar; doppeltes Stornieren
  → `409`.
- Geschädigt-FK auf soft-gelöschte Person bleibt zulässig (Schaden-Datensatz unverändert).

**Berechtigung:**

- Org-Isolation (fremder Einsatz → `403`/`404`); Test je Route — inkl. Cross-Org-Pfad
  über `ist_hoehere_berechtigung`, der für lesende Routen das richtige Verhalten zeigt.
- Nachlauffrist (nach Ablauf nur Einsatzleitung).
- Beobachter kann nicht schreiben.
- Abgeschlossener Einsatz: alle schreibenden Routen → `409` (`fordere_aktiv`).

**ETB-Leak:**

- Jeder Lifecycle-Event (Anlegen / `uebergeben` / `abschliessen` / Stornieren) erzeugt
  genau einen `typ=system`-Eintrag.
- Eintragstext enthält `registrier_nr` + Typ + Ausmaß + Ort-Kurzform (+ Status-Übergang
  + Übergabe-Adressat bzw. Abschluss-Grund); **kein** Geschädigt-Bezug (weder `R-nnn`
  noch `geschaedigt_kontakt`), **keine** freie `beschreibung` — eigener Leak-Test pro
  Pfad.

**HTTP:** End-to-End je Route inkl. Rechte-Matrix (Muster aus `tests/`).

**Frontend (`SchaedenPage.test.tsx`):**

- Liste/Filter (Status-Tabs, Typ-Filter, Ausmaß-Filter, Volltext), Schnellerfassung,
  Geschädigt-Toggle FK ↔ Freitext, Übergabe-Modal (Pflicht-Validierung
  `uebergeben_an`), Abschluss-Modal (Pflicht-Validierung `abschluss_grund`),
  disabled-Zustände je Status.
- Personen-Drawer-Erweiterung: „Als Geschädigte bei Schäden"-Block fetcht und rendert;
  reagiert auf `schaden`-SSE-Events.

## Akzeptanz

- Alle Repo-/HTTP-/Frontend-Tests grün via `rtk proxy cargo test` /
  `rtk proxy npm test` (ehrliche Exit-Codes ohne Hook-Maskierung).
- Frontend-Modul aktiviert; Navigation zeigt „Schäden" statt Stub.
- PROGRESS.md-Tabelle Teilprojekt 3 E‑5 auf ✅ DONE gesetzt.
- ETB-Leak-Tests beweisen, dass weder Geschädigt-Bezug noch `beschreibung` automatisch
  in `typ=system`-Einträge wandern.

## Offene Punkte / Folge-Specs

- **Geo-Koordinaten + Karten-Rendering** → T4 Lagekarte. ClickUp-Folge-Task ist beim
  Spec-Abschluss angelegt.
- **Foto-/Datei-Anhänge** — querschnittliche Spec für alle T3-Module gemeinsam.
- **Append-only Notizen-Verlauf** (E‑2-Pendant) — falls Schaden-Bearbeitung viel
  Inter-Kommunikation erzeugt; aktuell deckt der ETB die Verlaufs-Anforderung.
- **FK auf einsatz_tier bei tierkadaver** — bei Bedarf nachrüstbar (analoge XOR-Logik
  wie Geschädigt).
- **Mehrere Geschädigte (1:n)** — eigene Tabelle bei realem Bedarf (Reihenhaus,
  gemeinsamer Wald).
- **Abschnitts-Zuordnung** — falls Abschnittsleiter ihre Schäden gefiltert sehen wollen;
  UHS-Pattern (nullable FK).
- **Lese-Audit auf Schäden** — bewusst draußen (Annahme 10); bei Bedarf nachrüstbar
  wie in E‑1 angedacht.
- **CSV-Export** — analog `tiere/export`, falls Bilanz-Reporting es braucht.
- **Daten-Retention abgeschlossener Einsätze** — querschnittliche Folge-Spec; pseudonyme
  ETB-Spur ist bereits selbsttragend.
