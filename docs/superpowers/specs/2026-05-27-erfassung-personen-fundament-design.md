# E‑1 — Personen-Fundament + Erfassung

**Teilprojekt:** 3 „Erfassung" — Spec **1 von 5**. Legt die Personen-Entity, die
administrative Status-Maschine und das **sensible-Daten-Zugriffs-/Audit-Modell** an, das
E‑2…E‑5 wiederverwenden — analog wie [K&M‑1](2026-05-26-kraefte-mittel-fahrzeuge-disposition-design.md)
die generische Dispositions-Mechanik legte.

**Unterbau (wiederverwendet, nicht neu gebaut):** Rollen-/Nachlauf-Gate
(`src/einsatz/berechtigung.rs` — `darf_lesen`, `ist_schreibberechtigt`, `fordere_aktiv`,
`NACHLAUF_STUNDEN`), ETB-Schreibpfad (`src/etb/`), SSE-Live, Modul-Muster aus K&M
(`src/personal/`, `src/material/`). „Personen" ist im
[Navigations-Redesign](2026-05-25-navigation-redesign-design.md) Kategorie *Erfassung*,
Status `geplant` (heute `ModulStub`).

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 3 — Erfassung".

## Worum es geht

T3 „Erfassung" erfasst die im Einsatz betroffenen Subjekte/Objekte. Diese Spec baut das
**Schwergewicht und Fundament**: den **Personen-Stamm** des Einsatzes — Vermisste,
Betroffene, (später) Patienten, Verstorbene — als *EIN* Stamm mit Status-Lebenszyklus
(Navigations-Spec: „dieselbe physische Person wandert durch die Zustände; ein Modul mit
gefilterten Sichten, kein Modul je Status").

Drei Dinge sind hier strukturell anders als bei K&M und treiben das Design:

1. **Sensible Daten.** Personendaten (und ab E‑2 medizinische Sichtung) sind DSGVO-besondere
   Kategorie. Das K&M-Prinzip „alle Berechtigten lesen alles, frei nachlesbar im ETB" trägt
   nicht. → **Lese-Audit** auf Detail-Zugriffe + ETB nur **pseudonym**.
2. **Einsatz-scoped, kein globaler Stamm.** Anders als Personal/Fahrzeuge sind Betroffene
   keine wiederverwendbare Org-Ressource — sie gehören zu *diesem* Einsatz. Keine
   Disposition aus einem Pool, sondern direkte Erfassung in `einsatz_person`.
3. **Identität ist unsicher/unvollständig.** Im MANV werden Personen erfasst, bevor sie
   identifiziert sind („unbekannt männlich, ca. 40"). Identitätsfelder sind **optional**;
   eine server-vergebene **Registriernummer** ist die stabile Kennung (Patientenanhängekarte).

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **Personen sind einsatz-scoped** — Tabelle `einsatz_person`, kein globaler Stamm,
   keine Disposition.
2. **Unbekannte/teil-identifizierte Personen sind erstklassig** — alle Identitätsfelder
   optional; `registrier_nr` (server-vergeben, fortlaufend je Einsatz) ist die stabile Kennung.
3. **Zugriffsmodell = bestehendes Rollen-/Nachlauf-Modell wiederverwenden + Lese-Audit.**
   Keine Identität/Medizin-Datentrennung, keine eigene Sanitätsrolle. Jeder **Detail-Lese-**
   und **Export-Zugriff** wird append-only auditiert.
4. **E‑1 besitzt die administrative Status-Maschine; E‑2 legt die medizinische Sichtung
   (SK I–IV) als Attribut auf `betroffen` obendrauf.** Eine zusammenhängende Zustands-Maschine
   bleibt in E‑1.
5. **ETB-Spur pseudonym:** automatische Personen-Ereignisse schreiben ETB-Einträge `typ=system`
   nur mit `registrier_nr` + Status, **ohne** Identität. Volle Identität/Verlauf nur im
   Personen-Modul (hinter Lese-Audit).
6. **Neutraler Startzustand `erfasst`** beim Anlegen; Klassifikation (vermisst/betroffen/…)
   als eigener Schritt — erlaubt schnelle Masse-Erfassung im MANV mit Klassifikation danach.

## Scope

**Drinnen (E‑1):**

- Personen-Entity `einsatz_person` (einsatz-scoped, Soft-Delete, Registriernummer).
- Administrative Status-Maschine `{erfasst, vermisst, betroffen, verstorben, abgemeldet}`
  inkl. erlaubter Übergänge.
- CRUD + Status-Wechsel + Stornieren über Routen; Org-Isolation; Rollen-/Nachlauf-Gate.
- **Lese-Audit** (`person_zugriff_audit`, append-only) auf Detail-Öffnung + Export;
  Audit-Einsicht für die Einsatzleitung.
- **Pseudonyme ETB-Spur** (`typ=system`) bei Anlegen / Status-Wechsel / Verstorben / Stornieren.
- SSE-Live (Event ohne sensible Payload, Client refetcht).
- Frontend-Modul „Personen": Liste mit Status-Sichten, Detail-Drawer, Anlege-Flows.

**Draußen (eigene/spätere Specs):**

- **Medizinische Sichtung SK I–IV, Verletzungs-/Befundnotiz, Transport/Verbleib,
  Vermisstenabgleich** — E‑2.
- **Strukturierte Zuordnung zu einer Unfallhilfsstelle** (E‑1 hat nur `antreff_ort`-Freitext) — E‑3.
- **Feldgenaue Änderungs-Historie (Diffs):** bewusst draußen — E‑1-Felder sind überwiegend
  nicht-besondere Kategorie; aktueller Datensatz + pseudonyme ETB-Spur + Lese-Audit genügen.
  Bei Bedarf in E‑2 (besondere Kategorie) wieder aufnehmbar.
- **Eigene Sanitäts-/Med-Rolle, feldgenaue Zugriffstrennung** — bewusst draußen (Annahme 3).
- **Daten-Retention abgeschlossener Einsätze** (ETB + PDF, Eindampfen) — querschnittliche Folge-Spec.
- **Angehörigen-/Personenauskunft nach außen** — eigenes späteres Thema.

## Datenmodell

```sql
-- Migration 0020_einsatz_person.sql
CREATE TABLE einsatz_person (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr   INTEGER NOT NULL,           -- fortlaufend je Einsatz (server-autoritativ)
    status          TEXT    NOT NULL DEFAULT 'erfasst',
                    -- erfasst | vermisst | betroffen | verstorben | abgemeldet

    -- Identität (alle optional — unbekannte Personen erstklassig)
    name            TEXT,
    vorname         TEXT,
    geschlecht      TEXT,                        -- maennlich | weiblich | divers | unbekannt
    geburtsdatum    TEXT,                        -- YYYY-MM-DD, falls bekannt
    alter_geschaetzt INTEGER,                    -- geschätztes Alter in Jahren, falls geburtsdatum NULL
    herkunft_adresse TEXT,

    -- Erfassungskontext
    antreff_ort     TEXT,                        -- Freitext (strukturierte Unfallhilfsstelle → E‑3)
    melder_kontakt  TEXT,                        -- bei vermisst: wer meldet (Angehöriger/Kontakt)
    notiz           TEXT,

    -- Meta / Audit
    erfasst_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von     INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von   INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at    TEXT,                        -- Soft-Delete (Fehleingabe); kein Hard-Delete

    UNIQUE (einsatz_id, registrier_nr)
);

CREATE INDEX idx_einsatz_person_einsatz ON einsatz_person (einsatz_id, status);
```

```sql
-- Migration 0021_person_zugriff_audit.sql  (append-only — kein UPDATE/DELETE)
CREATE TABLE person_zugriff_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER REFERENCES einsatz_person(id),  -- NULL bei Export gesamter Liste
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
    art         TEXT    NOT NULL,                        -- 'detail' | 'export'
    zugriff_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE INDEX idx_person_audit_einsatz ON person_zugriff_audit (einsatz_id, zugriff_at);
```

**Registriernummer:** server-autoritativ vergeben (`MAX(registrier_nr)+1` je `einsatz_id`,
in derselben Transaktion wie das Insert — gleiches Muster wie ETB-`lfd_nr`). Anzeige z. B.
als `R‑042`. Stabile, nicht-identifizierende Kennung für ETB-Spur und Patientenanhängekarte.

## Status-Maschine (administrativ, E‑1)

Zustände: `erfasst` (neutral, initial) · `vermisst` · `betroffen` · `verstorben` (terminal)
· `abgemeldet` (terminal). Erlaubte Übergänge:

- **Anlegen** → immer `erfasst` (neutral).
- `erfasst → {vermisst, betroffen, verstorben, abgemeldet}` (auch direkt `verstorben`:
  vor jeder Klassifikation tot aufgefunden).
- `vermisst ↔ betroffen` (Aufgefundene werden `betroffen`; das *Verknüpfen* einer
  Vermisstmeldung mit einer aufgefundenen Person = Vermisstenabgleich, **E‑2**).
- `vermisst | betroffen → verstorben`.
- jeder Zustand `→ abgemeldet` (Person hat den Einsatz verlassen / unverletzt entlassen).
- `verstorben` / `abgemeldet` terminal; Korrektur (zurück) nur mit Schreibrecht (Fehleingabe).

Übergänge werden serverseitig validiert (ungültiger Übergang → `422`). E‑2 ergänzt die
**Sichtungskategorie SK I–IV** als separates Attribut auf `betroffen` — die hier definierte
Status-Maschine bleibt unangetastet.

## Berechtigung & Audit

- **Lesen** (Liste + Detail): bestehende `darf_lesen` (Mitgliedschaft + Nachlauffrist; höhere
  Berechtigung org-übergreifend). **Jede Detail-Öffnung** (`GET …/:pid`) **und jeder Export**
  schreibt einen `person_zugriff_audit`-Eintrag.
  *Listen-Reads werden bewusst nicht auditiert* (würden bei SSE-Refetch auf jedem offenen
  Client dauernd feuern → Lärm ohne Aussagewert). Audit-Aussage: „wer **öffnete/exportierte**
  welche Person".
- **Schreiben** (anlegen / bearbeiten / Status / stornieren): `ist_schreibberechtigt`
  (Einsatzleitung + Führungspersonal); Beobachter nur lesend. **Abgeschlossener Einsatz =
  read-only** (`fordere_aktiv`).
- **Audit-Einsicht** (`GET …/:pid/audit`): nur **Einsatzleitung** (`fordere_einsatzleitung`).
- **Org-Isolation:** jede Query trägt das `einsatz_id`-Prädikat; Routen sind unter dem
  Einsatz-Scope montiert und prüfen Lese-/Schreibzugriff wie die übrigen Einsatz-Sub-Routen.

## ETB-Integration (pseudonym)

Anlegen / Status-Wechsel / Verstorben / Stornieren → je **ein** ETB-Eintrag `typ=system`,
Text nur mit `registrier_nr` + Status, z. B. „Person R‑042: vermisst → betroffen" oder
„Person R‑042 erfasst". **Keine** Identität, kein medizinisches Detail.

> **Geltungsbereich der Pseudonymität:** Sie gilt für die **automatisch** geschriebenen
> `typ=system`-Einträge. **Manuelle** ETB-Einträge sind Freitext und können identifizierende
> Texte enthalten — sie unterliegen der allgemeinen ETB-Sicht. Ein UI-Hinweis bei
> Personenbezug in manuellen Einträgen ist späteres Thema.

Wer eine `R‑nnn` zur echten Identität auflösen will, braucht Personen-Detailzugriff —
und der ist auditiert. Diese Asymmetrie ist gewollt.

## Live / SSE

Personen-Änderung broadcastet ein SSE-Event mit **nur** `einsatz_id` + `person_id` (keine
sensible Payload); Clients refetchen. Verhindert breites Streamen sensibler Daten und hält
den Live-Pfad konsistent mit dem bestehenden K&M-Muster.

## Routen (API)

Alle unter `/api/einsaetze/:id/personen`, montiert im Einsatz-Scope (Lese-/Schreib-Gate).

| Methode | Pfad | Zweck | Recht |
|---|---|---|---|
| `GET` | `/personen` | Liste (Filter `?status=`), nicht auditiert | Lesen |
| `POST` | `/personen` | Anlegen (Status = `erfasst`), Registriernr vergeben | Schreiben |
| `GET` | `/personen/:pid` | Detail — **schreibt Audit** | Lesen |
| `PATCH` | `/personen/:pid` | Identitäts-/Kontextfelder bearbeiten | Schreiben |
| `POST` | `/personen/:pid/status` | Status-Wechsel (validiert) | Schreiben |
| `DELETE` | `/personen/:pid` | Stornieren (Soft-Delete) | Schreiben |
| `GET` | `/personen/:pid/audit` | Lese-Audit der Person | Einsatzleitung |
| `GET` | `/personen/export` | Export (CSV) — **schreibt Audit** | Lesen |

Status-Wechsel / Anlegen / Stornieren schreiben in derselben Transaktion die pseudonyme
ETB-Spur und lösen das SSE-Event aus.

## Frontend

Modul „Personen" (Kategorie *Erfassung*), ersetzt den `ModulStub` (`modulRegistry`-Eintrag
`personen` existiert bereits). Muster wie `PersonalPage`/Material-Tab.

- **Liste** mit Status-Sichten als Tabs/Filter: **„Neu"** (`erfasst`, Default-Landung nach
  Schnellerfassung) · Vermisst · Betroffen · Verstorben · Alle. Spalten: Registriernr,
  Status-Badge, Name oder „unbekannt", Geschlecht/Alter, Antreffort.
- **Schnellerfassung**: minimaler Anlege-Flow (Geschlecht/Alter geschätzt + Antreffort
  genügen) → Person `erfasst`; auf Masse im MANV ausgelegt.
- **Anlege-Flows**: „Vermisst melden" (mit `melder_kontakt`) und „Betroffene/n erfassen"
  setzen direkt den passenden Status nach dem Anlegen.
- **Detail-Drawer**: voller Datensatz (Lesezugriff → Audit), Status-Aktionen, Bearbeiten,
  Stornieren. Audit-Einsicht nur für Einsatzleitung sichtbar.
- Schreibaktionen für Beobachter / abgeschlossenen Einsatz disabled (Muster aus K&M).

## Tests

- **Repo:** CRUD; Registriernr fortlaufend + lückenlos je Einsatz; Status-Übergänge
  (gültige erlaubt, ungültige `422`); Soft-Delete blendet aus Liste aus, bleibt referenzierbar.
- **Berechtigung:** Org-Isolation (fremder Einsatz → `403`/`404`); Nachlauffrist (nach
  Ablauf nur Einsatzleitung); Beobachter kann nicht schreiben; abgeschlossener Einsatz read-only.
- **Audit:** Detail-Öffnung schreibt genau **einen** Eintrag; Liste schreibt **keinen**;
  Export schreibt einen; Audit-Einsicht nur Einsatzleitung.
- **ETB:** Anlegen/Status/Verstorben/Stornieren erzeugen je einen `typ=system`-Eintrag;
  Eintragstext enthält `registrier_nr` + Status und **keinen** `name`/`vorname` (Leak-Test).
- **HTTP:** End-to-End je Route inkl. Rechte-Matrix.
- **Frontend:** Komponententests analog `PersonalTab.test.tsx` (Liste/Filter, Anlege-Flows,
  disabled-Zustände).

## Offene Punkte / Folge-Specs

- **E‑2 Sichtung & medizinischer Verlauf** baut auf dieser Status-Maschine auf (SK I–IV als
  Attribut auf `betroffen`); dort ggf. feldgenaue Diffs für besondere Kategorie erneut prüfen.
- **E‑3 Unfallhilfsstellen** ersetzt den `antreff_ort`-Freitext durch strukturierte Zuordnung.
- **Listen-Lese-Audit** bewusst weggelassen (SSE-Refetch-Lärm); falls Nachweis „wer sah die
  Liste" doch gefordert wird → debounced Initial-Load-Audit nachrüstbar.
- **Daten-Retention** (Eindampfen abgeschlossener Einsätze) — querschnittliche Folge-Spec;
  die pseudonyme ETB-Spur ist dafür bereits selbsttragend.
