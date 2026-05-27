# E‑2 — Sichtung & medizinischer Verlauf

**Teilprojekt:** 3 „Erfassung" — Spec **2 von 5**. Legt die **medizinische Schicht** auf
die in [E‑1](2026-05-27-erfassung-personen-fundament-design.md) gebaute Personen-Entity:
Sichtungskategorien (Triage), medizinischen Verlauf (Befund/Notizen), Transport/Verbleib
und den Vermisstenabgleich.

**Unterbau (wiederverwendet, nicht neu gebaut):** Personen-Entity + administrative
Status-Maschine (`src/person/`, Migr. `0020`–`0021`), Lese-Audit (`person_zugriff_audit`),
pseudonyme ETB-Spur + `etb_system`-Helfer und `person`-SSE-Event
(`src/routes/einsatz_person.rs`), Rollen-/Nachlauf-Gate (`src/einsatz/berechtigung.rs` —
`fordere_lesezugriff`, `fordere_schreibrecht`, `fordere_aktiv`, `fordere_einsatzleitung`).

**Teilprojekt-Rahmen:** `docs/superpowers/PROGRESS.md` → „Teilprojekt 3 — Erfassung".

## Worum es geht

E‑1 hat die Person als *einen* Stamm mit administrativem Status-Lebenszyklus angelegt und
„Patient" bewusst **nicht** als eigenen Status modelliert, sondern als medizinische Schicht
auf `betroffen` (E‑1-Annahme 4). E‑2 baut genau diese Schicht:

- **Sichtung (Triage)** — die Sichtungskategorie SK I–IV / tot / unverletzt, als **Verlauf**
  (Re-Sichtung bei Verschlechterung/Verbesserung) + denormalisiertes Cache-Feld fürs Lagebild.
- **Medizinischer Verlauf** — append-only Verletzungs-/Befundnotizen (besondere Kategorie).
- **Transport/Verbleib** — wohin die Person abtransportiert/entlassen wurde (Krankenhaus als
  Freitext), ebenfalls als Verlauf.
- **Vermisstenabgleich** — zweistufige Verknüpfung (Verdacht → bestätigt) einer
  Vermisstmeldung mit einer aufgefundenen Person.

Alles Medizinische ist **append-only** (nichts wird überschrieben) — damit ist die für die
besondere Datenkategorie nötige Nachvollziehbarkeit ohne separate Diff-Mechanik gegeben.
Die Sichtbarkeit folgt dem E‑1-Modell: pseudonyme ETB-Spur für lagerelevante Ereignisse,
voller Verlauf nur im Personen-Modul hinter Lese-Audit, keine sensible Payload im SSE.

## Gesetzte Annahmen (in dieser Spec abgestimmt, nicht neu verhandeln)

1. **„Patient" ist kein Admin-Status.** Patient = `betroffen` *mit* gesetzter Sichtung. Die
   E‑1-Status-Maschine (`erfasst·vermisst·betroffen·verstorben·abgemeldet`) bleibt
   **unangetastet** (gleichrangig zu E‑1-Annahme 4). E‑3/E‑4 ziehen dieses Thema nicht erneut auf.
2. **Sichtung = Verlauf + Cache.** Append-only `person_sichtung` (jede (Re-)Sichtung ein
   Eintrag) PLUS denormalisiertes `aktuelle_sichtung` auf `einsatz_person` für Liste/Filter/Lagebild.
3. **`unverletzt` ist ein vollwertiger Sichtungs-Ausgang.** Das Lagebild trennt damit drei
   Gruppen: **ungesichtet** (kein Eintrag) / **Patient** (SK I–IV, tot) / **unverletzt** (gesichtet,
   keine Behandlung). „ungesichtet" und „unverletzt" fallen *nicht* zusammen.
4. **Sichtung=tot ist entkoppelt von Admin-Status `verstorben`.** Die Sichtungskategorie `tot`
   ist ein medizinisches Sichtungsurteil; der administrative Übergang `→ verstorben` bleibt eine
   eigene, bewusste Aktion (das UI **schlägt** ihn vor). Zwei getrennte, einzeln nachvollziehbare Fakten.
5. **Sichtung hebt `erfasst` auf `betroffen` an (vorwärts).** Wird eine `erfasst`-Person
   gesichtet, setzt der Sichtungs-Endpunkt sie in derselben Transaktion auf `betroffen` (Sichtung
   impliziert „anwesend & betroffen"). Das ist eine *Vorwärts-Klassifikation* — die in (4)
   beschriebene Entkopplung gilt nur für die terminale, rechtlich/sensibel geprägte
   Feststellung `tot → verstorben`, nicht für diese Klassifikation.
6. **Transport/Verbleib = append-only Ereignisse, Krankenhaus = Freitext.** Kein
   Krankenhaus-Stamm (Kapazität/Verfügbarkeit) — eigene spätere Spec.
7. **Befund-/Verlaufsnotizen = append-only.** Keine Bearbeitung/Löschung; Korrektur einer
   Notiz = neue Notiz (analog ETB-Berichtigungsgedanke).
8. **Vermisstenabgleich zweistufig (Verdacht → bestätigt/verworfen).** Verdacht anlegen =
   schreibberechtigt; **Bestätigen/Verwerfen = nur Einsatzleitung** (Folge: Statuswechsel der
   Vermisstmeldung + faktische Aussage Richtung Angehörigen-Kommunikation).
9. **Zeitstempel = Server-Jetzt, kein User-Backdating in E‑2.** Einfüge-Reihenfolge = Zeit-
   Reihenfolge → jeder Insert überschreibt das Cache-Feld trivial korrekt. Benutzerdefinierte
   Ereigniszeit ist eine Folge-Idee (siehe Offene Punkte).

## Scope

**Drinnen (E‑2):**

- **Sichtungs-Verlauf** `person_sichtung` (append-only) + Cache-Spalten auf `einsatz_person`.
- **Medizinische Verlaufsnotizen** `person_verlaufsnotiz` (append-only, besondere Kategorie).
- **Transport/Verbleib** `person_verbleib` (append-only) + Cache-Spalte.
- **Vermisstenabgleich** `person_abgleich` (Verdacht → bestätigt/verworfen).
- Routen für Sichten / Notiz / Verbleib / Abgleich; med. Verlauf in der Detail-Antwort.
- Pseudonyme ETB-Spur (Sichtung, Verbleib, Abgleich-Bestätigung); **kein** ETB für Befundnotizen.
- SSE-`person`-Event (ohne sensible Payload) bei jeder Änderung; Lese-Audit über die
  bestehende Detail-Öffnung.
- Frontend: Tab „Medizinischer Verlauf" im Detail-Drawer, SK-Badge/-Spalte + Lagebild-Zählung,
  Vermisstenabgleich-Flow.

**Draußen (eigene/spätere Specs):**

- **Krankenhaus-Stamm** (Kapazität/Verfügbarkeit, strukturierte Ziel-Auswahl) — eigene spätere Spec.
- **Strukturierte Zuordnung zu einer Unfallhilfsstelle** (interne Örtlichkeit: Patientenablage,
  Behandlungsplatz, Verletztensammelstelle) — **E‑3**. E‑2-Verbleib bildet die *externe* Seite
  (Abtransport/Entlassung), `antreff_ort` bleibt Freitext (E‑1).
- **Benutzerdefinierte Ereigniszeit / Backdating** für Sichtung/Notiz/Verbleib — Folge-Idee.
- **Drei-Zeitstempel-Modell** (wie ETB) für medizinische Ereignisse — nicht nötig (live erfasst).
- **Eigene Sanitäts-/Med-Rolle, feldgenaue Zugriffstrennung** — bewusst draußen (E‑1-Annahme 3).
- **Angehörigen-/Personenauskunft nach außen** — eigenes späteres Thema.

## Datenmodell

Migrations-Inventar (additiv zu E‑1, das bei `0021` endet):

| Migration | Inhalt |
|---|---|
| `0022_einsatz_person_med_cache.sql` | `ALTER TABLE einsatz_person` → Cache-Spalten |
| `0023_person_sichtung.sql` | Sichtungs-Verlauf |
| `0024_person_verlaufsnotiz.sql` | Befund-/Verlaufsnotizen |
| `0025_person_verbleib.sql` | Transport/Verbleib |
| `0026_person_abgleich.sql` | Vermisstenabgleich |

```sql
-- Migration 0022_einsatz_person_med_cache.sql
ALTER TABLE einsatz_person ADD COLUMN aktuelle_sichtung    TEXT;  -- NULL = ungesichtet
ALTER TABLE einsatz_person ADD COLUMN aktuelle_sichtung_at TEXT;
ALTER TABLE einsatz_person ADD COLUMN aktueller_verbleib   TEXT;  -- Kurzform letzter Verbleib; NULL = vor Ort
```

```sql
-- Migration 0023_person_sichtung.sql  (append-only — kein UPDATE/DELETE)
CREATE TABLE person_sichtung (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id     INTEGER NOT NULL REFERENCES einsatz_person(id),
    kategorie     TEXT    NOT NULL
                  CHECK (kategorie IN ('sk1','sk2','sk3','sk4','tot','unverletzt')),
    notiz         TEXT,                       -- optionale Kurzbegründung zum Sichtungszeitpunkt
    gesichtet_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    gesichtet_von INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_sichtung_person ON person_sichtung (person_id, gesichtet_at);
```

```sql
-- Migration 0024_person_verlaufsnotiz.sql  (append-only — besondere Kategorie)
CREATE TABLE person_verlaufsnotiz (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER NOT NULL REFERENCES einsatz_person(id),
    text        TEXT    NOT NULL,
    erfasst_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_verlaufsnotiz_person ON person_verlaufsnotiz (person_id, erfasst_at);
```

```sql
-- Migration 0025_person_verbleib.sql  (append-only)
CREATE TABLE person_verbleib (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id      INTEGER NOT NULL REFERENCES einsatz_person(id),
    art            TEXT    NOT NULL
                   CHECK (art IN ('transport','entlassung','vor_ort','verstorben')),
    transportmittel TEXT,                     -- Freitext (RTW, KTW, …), optional
    ziel           TEXT,                      -- Freitext-Krankenhaus/Ziel, optional
    status         TEXT
                   CHECK (status IS NULL OR status IN ('angemeldet','abtransportiert')),
    notiz          TEXT,
    zeitpunkt_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von    INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_verbleib_person ON person_verbleib (person_id, zeitpunkt_at);
```

```sql
-- Migration 0026_person_abgleich.sql
CREATE TABLE person_abgleich (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vermisst_person_id INTEGER NOT NULL REFERENCES einsatz_person(id),  -- Status vermisst
    gefunden_person_id INTEGER NOT NULL REFERENCES einsatz_person(id),  -- Status betroffen|verstorben
    status            TEXT    NOT NULL DEFAULT 'verdacht'
                      CHECK (status IN ('verdacht','bestaetigt','verworfen')),
    erstellt_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erstellt_von      INTEGER NOT NULL REFERENCES benutzer(id),
    entschieden_at    TEXT,
    entschieden_von   INTEGER REFERENCES benutzer(id),
    CHECK (vermisst_person_id <> gefunden_person_id)
);
-- Höchstens EIN bestätigter Abgleich je Vermisstmeldung:
CREATE UNIQUE INDEX idx_person_abgleich_bestaetigt
    ON person_abgleich (vermisst_person_id) WHERE status = 'bestaetigt';
CREATE INDEX idx_person_abgleich_einsatz ON person_abgleich (einsatz_id);
```

**Cache-Konsistenz:** Jeder Sichtungs-/Verbleib-Insert aktualisiert in **derselben
Transaktion** das jeweilige Cache-Feld auf `einsatz_person`. Da Zeitstempel Server-Jetzt sind
(Annahme 9), ist „jüngster Eintrag = zuletzt eingefügt" garantiert — kein „bin ich der
jüngste?"-Check nötig.

## Sichtung (Triage)

- **Kategorien:** `sk1` (rot, akut vital bedroht) · `sk2` (gelb, schwer) · `sk3` (grün, leicht)
  · `sk4` (blau, ohne Überlebenschance/abwartend) · `tot` (schwarz) · `unverletzt`.
  Rust-Enum `Sichtungskategorie` (analog `PersonStatus`: `as_str`/`parse`), String muss exakt
  dem CHECK-Constraint entsprechen.
- **Keine Übergangsrestriktion zwischen Kategorien** (anders als der Admin-Status): medizinische
  Lage ändert sich frei (Verschlechterung *und* Verbesserung). Der Verlauf dokumentiert die Abfolge.
- **Voraussetzung:** Person nicht storniert; Status `betroffen` oder `verstorben`. Bei `erfasst`
  hebt der Endpunkt sie in derselben Transaktion auf `betroffen` (Annahme 5). Bei `vermisst`/
  `abgemeldet` → `422` (nicht anwesend bzw. abgeschlossen).
- **Sichtung=tot:** setzt **nicht** automatisch `verstorben` (Annahme 4). Die API-Antwort/SSE
  signalisiert den Cache-Stand; das UI bietet daraufhin die Aktion „Status → verstorben" an.

## Transport/Verbleib

Append-only `person_verbleib`-Ereignisse; das jüngste füllt `aktueller_verbleib` (Kurzform,
z. B. „Transport → [Ziel]", „entlassen", „vor Ort"). `art`:

- `transport` — Abtransport (mit `transportmittel`/`ziel`/`status` angemeldet→abtransportiert),
- `entlassung` — vor Ort entlassen,
- `vor_ort` — verbleibt in Behandlung vor Ort,
- `verstorben` — Verbleib des Leichnams.

Krankenhaus/Ziel ist Freitext (Annahme 6). Korrektur/Umleitung = neuer Verbleib-Eintrag.

## Medizinische Verlaufsnotizen

Append-only `person_verlaufsnotiz` (besondere Kategorie). Korrektur = neue Notiz (Annahme 7).
**Nie ins ETB**, nie in den SSE-Payload — nur im Personen-Modul, hinter der auditierten
Detail-Öffnung sichtbar.

## Vermisstenabgleich (Verdacht → bestätigt/verworfen)

- **Verdacht anlegen** (`status='verdacht'`): schreibberechtigt. `vermisst_person_id` muss
  Status `vermisst` haben, `gefunden_person_id` Status `betroffen`/`verstorben`; beide nicht
  storniert, gleicher Einsatz, nicht dieselbe Person. Mehrere Verdachts-Links erlaubt.
- **Entscheiden** (`bestaetigt`/`verworfen`): **nur Einsatzleitung** (Annahme 8). Nur aus
  `verdacht` heraus; setzt `entschieden_at`/`entschieden_von`.
- **Bei `bestaetigt`** (eine Transaktion): die Vermisstmeldung (`vermisst_person_id`) wechselt
  auf `abgemeldet` (aufgeklärt — die reale Person ist der gefundene Datensatz); der partielle
  Unique-Index erzwingt höchstens **einen** bestätigten Abgleich je Vermisstmeldung; pseudonymer
  ETB-Eintrag wird geschrieben.

## Berechtigung & Audit

- **Schreiben** (Sichtung / Notiz / Verbleib / Abgleich anlegen): `fordere_schreibrecht` +
  `fordere_aktiv` (abgeschlossener Einsatz read-only). Beobachter nur lesend.
- **Abgleich entscheiden:** zusätzlich `fordere_einsatzleitung`.
- **Lesen / Lese-Audit:** Der medizinische Verlauf (Sichtungen, Notizen, Verbleib, Abgleiche)
  wird **in der bestehenden `GET …/:pid`-Detailantwort** mitgeliefert → genau **ein**
  `detail`-Audit-Eintrag beim Öffnen (E‑1-Mechanik). Keine eigenen lesenden Sub-Endpunkte →
  kein Mehrfach-Audit. Listen-Reads bleiben (wie E‑1) un-auditiert.
- **Audit-Einsicht** (`GET …/:pid/audit`): weiterhin nur Einsatzleitung.
- **Org-Isolation:** jede Query trägt `einsatz_id`; Routen unter dem Einsatz-Scope, Lese-/
  Schreib-Gate wie die übrigen Einsatz-Sub-Routen.

## ETB-Integration (pseudonym)

Über den bestehenden `etb_system`-Helfer (`typ=system`, nur `registrier_nr` + Sachverhalt):

- **Sichtung** → „Person R‑042: Sichtung SK II" (bzw. „… tot", „… unverletzt").
- **Verbleib** → „Person R‑042: abtransportiert → [Ziel]" / „… entlassen" / „… verbleibt vor Ort".
- **Abgleich bestätigt** → „Vermisstmeldung R‑007 aufgeklärt — identisch mit R‑042".
- **Befund-/Verlaufsnotizen** → **kein** ETB-Eintrag (besondere Kategorie).

Jeweils in derselben Transaktion wie der fachliche Insert; danach `person`-SSE-Event.

## Live / SSE

Wie E‑1: Sichtung/Verbleib/Notiz/Abgleich broadcasten ein `person`-Event mit **nur**
`einsatz_id` + `person_id`; Clients refetchen. Keine sensible Payload (insb. kein Befundtext,
keine Identität) im Stream.

## Routen (API)

Alle unter `/api/einsaetze/:id/personen/…`, montiert im Einsatz-Scope.

| Methode | Pfad | Zweck | Recht |
|---|---|---|---|
| `POST` | `/personen/:pid/sichtung` | Sichtung erfassen (Verlauf + Cache); ggf. `erfasst→betroffen` | Schreiben |
| `POST` | `/personen/:pid/verbleib` | Verbleib-Ereignis erfassen (Verlauf + Cache) | Schreiben |
| `POST` | `/personen/:pid/notizen` | Verlaufsnotiz anlegen | Schreiben |
| `POST` | `/personen/:pid/abgleich` | Verdachts-Link auf gefundene Person anlegen | Schreiben |
| `POST` | `/personen/:pid/abgleich/:aid/entscheidung` | Bestätigen/Verwerfen | Einsatzleitung |

Lesen: der med. Verlauf ist Teil der `GET …/:pid`-Detailantwort (E‑1, auditiert). Alle
schreibenden Routen schreiben in derselben Transaktion die pseudonyme ETB-Spur (außer Notizen)
und lösen das `person`-SSE-Event aus.

## Frontend

Modul „Personen" (E‑1) wird erweitert — Muster wie E‑1/`PersonalPage`:

- **Liste/Lagebild:** SK-Spalte mit Farb-Badge (SK I rot · II gelb · III grün · IV blau · tot
  schwarz · unverletzt neutral · ungesichtet grau). Sichtungs-Zählung je Kategorie (Lageüberblick).
- **Detail-Drawer, neuer Tab „Medizinischer Verlauf":** aktuelle Sichtung als Badge,
  „Re-Sichten"-Aktion (Kategorie-Auswahl + optionale Kurznotiz); bei Auswahl `tot` Hinweis/
  Button „Status → verstorben". Chronologischer Verlauf (Sichtungen + Notizen + Verbleib
  gemerged, neueste zuerst). Notiz-Erfassung (append-only). Verbleib-Erfassung (Art + Felder).
- **Vermisstenabgleich:** in der Vermisst-Sicht je Eintrag „Abgleich vorschlagen" (Auswahl einer
  gefundenen Person) → Verdacht; offene Verdachts-Links mit „Bestätigen/Verwerfen" (nur für
  Einsatzleitung sichtbar/aktiv).
- Schreibaktionen für Beobachter / abgeschlossenen Einsatz disabled (E‑1-Muster).

## Tests

- **Sichtung:** Verlauf append-only; Cache spiegelt jüngste Sichtung; jede Kategorie auf jede
  möglich (keine Übergangsrestriktion); `erfasst` wird durch Sichtung auf `betroffen` gehoben;
  Sichtung bei `vermisst`/`abgemeldet`/storniert → `422`; **`tot` ändert den Admin-Status nicht**.
- **Verbleib:** Verlauf append-only; Cache spiegelt jüngsten Verbleib; ungültige `art`/`status` → Fehler.
- **Notizen:** append-only; erscheinen im Detail-Verlauf.
- **Abgleich:** Verdacht nur auf passende Status (vermisst ↔ betroffen/verstorben), sonst `422`;
  Entscheiden nur Einsatzleitung (Schreibberechtigter ohne Leitung → `403`); `bestaetigt` setzt
  Vermisstmeldung auf `abgemeldet`; **zweiter `bestaetigt` je Vermisstmeldung → Konflikt**
  (Unique-Index); `verworfen` lässt Status unverändert.
- **ETB/Leak:** Sichtung/Verbleib/Abgleich-Bestätigung erzeugen je einen `typ=system`-Eintrag
  mit `registrier_nr`; **Befundnotiz erzeugt keinen** ETB-Eintrag; Eintragstext enthält weder
  `name`/`vorname` noch Befundtext (Leak-Test); Befundtext nie im SSE-Payload.
- **Audit:** Detail-Öffnung mit med. Verlauf schreibt genau **einen** `detail`-Eintrag (kein
  Mehrfach-Audit durch den Verlauf).
- **Berechtigung:** Org-Isolation (fremder Einsatz → `403`/`404`); Nachlauffrist; Beobachter
  kann nicht schreiben; abgeschlossener Einsatz read-only.
- **HTTP:** End-to-End je Route inkl. Rechte-Matrix.
- **Frontend:** Komponententests analog E‑1 (SK-Badge/-Filter, Re-Sichten-Flow inkl.
  tot-Vorschlag, Verbleib-/Notiz-Erfassung, Abgleich-Flow, disabled-Zustände).

## Offene Punkte / Folge-Specs

- **Benutzerdefinierte Ereigniszeit / Backdating** für Sichtung/Notiz/Verbleib (z. B. nachträglich
  dokumentierte Sichtung): bewusst draußen (Annahme 9). Bei Bedarf nachrüstbar — dann braucht der
  Cache-Update einen „bin ich der jüngste?"-Check.
- **Krankenhaus-Stamm** (Kapazität/Verfügbarkeit, strukturierte Ziel-Auswahl statt Freitext) —
  eigene spätere Spec; `person_verbleib.ziel` (Freitext) ist dann optional auf eine FK migrierbar.
- **Strukturierte Unfallhilfsstellen-Zuordnung** (interne Örtlichkeit) — **E‑3**; ersetzt
  `antreff_ort`-Freitext und ergänzt den internen Verbleib (Patientenablage/Behandlungsplatz).
- **PDF-/Druck-Report:** medizinischer Verlauf + Sichtungsstand als Teil des selbsttragenden
  Einsatz-Reports (querschnittliche Folge-Spec, vgl. Daten-Retention in PROGRESS.md).
