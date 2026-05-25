# Modul „Einsatzdaten" — Kopfdaten eines Einsatzes

**Datum:** 2026-05-25
**Status:** Design abgestimmt, bereit für Implementierungsplan
**Vorgänger:** [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) — definiert das Modul-Gerüst; „Einsatzdaten" ist dort Kategorie *Führung*, Status `geplant` (heute nur `ModulStub`).

## Problem

Die „Einsatzdaten"-Seite (`/einsaetze/:id/einsatzdaten`) ist heute ein Platzhalter. Sie soll das erste echte Führungs-Modul werden: die **Kopf-/Stammdaten eines Einsatzes** anzeigen und bearbeitbar machen. Das bestehende Datenmodell kennt nur `bezeichnung`, `stichwort` (Freitext), `status`, `begonnen_at`, `abgeschlossen_at/_von` sowie die Einsatzleitung über `einsatz_mitgliedschaft`. Für einen brauchbaren Einsatzkopf fehlen die zentralen Felder eines Einsatzauftrags/Meldebilds.

## Recherche-Grundlage (warum diese Felder)

Konsolidiert aus BOS-Doktrin (FwDV/DV 100, Einsatzstichwort-Systematik, Einsatztagebuch-Köpfe) und realen Systemen (DIVERA 24/7, FeuerSoftware Connect, iSE-COBRA/EDP, HiOrg-Server). Beide Quellen konvergieren auf einen gemeinsamen Kern, abgebildet auf die W-Fragen der Notrufabfrage. Das Produkt ist orga-übergreifend (weiße HiOrg **und** FW-nahe BOS), daher deckt der Feldsatz sowohl den Ad-hoc-Einsatz als auch den geplanten Sanitätsdienst ab.

| W-Frage | Feld |
|---|---|
| Was (Kurzname) | Einsatzbezeichnung |
| Was (codiert) | Einsatzstichwort |
| Wo | Einsatzort/Adresse (+ optional Koordinate) |
| Wann | Beginn / Ende |
| Wer meldet | Meldende/anfordernde Stelle |
| Wer führt | Einsatzleitung |
| Wie viele | Anzahl Betroffene initial |

## Abgestimmte Entscheidungen

1. **Feld-Umfang:** Kern + Kür (alle unten gelisteten Felder).
2. **Einsatzstichwort:** Freitext-**Combobox** mit org-weit, **admin-konfigurierbaren Vorschlägen** (kein starres Enum — Stichwort-Systematik ist land-/orga-abhängig).
3. **Schreibrecht (aktiver Einsatz):** Einsatzleitung **+** Führungspersonal **+** System-Admin. Beobachter nur lesend. **Abgeschlossener Einsatz = read-only** (bestehendes Muster `fordere_aktiv`).
4. **Seiten-UX:** Lesemodus (antd `Descriptions`) + „Bearbeiten"-Button → Formular mit Speichern/Abbrechen. Ein atomares Speichern.
5. **Stichwort-Vorschläge-Katalog:** gepflegt im globalen Stammdaten-Bereich (org-weit, nur Admins editierbar).
6. **Alarmzeit mit Audit-Trennung:** `begonnen_at` (Alarmzeit) editierbar; zusätzlich `angelegt_at` als read-only technischer Anlage-Zeitpunkt (Original bleibt nachvollziehbar).
7. **Koordinate** jetzt schon als zwei manuelle Zahlenfelder (Lat/Lon); Karten-Picker erst später im Lage-Modul.
8. **Einsatznummer-Format** `JJJJ-NNN` (z. B. `2026-001`), fortlaufend je Organisation/Jahr, **je Organisation eindeutig** (Unique-Index; Dublette → 409).
9. **Admin-Schreibrecht über ein eigenes Gate** der PATCH-Route (Schreibrecht ODER System-Admin); `fordere_schreibrecht`/ETB-Semantik bleibt unverändert.

## Scope-Abgrenzung

**Drin:** Anzeigen + Bearbeiten der Einsatz-Kopfdaten; org-weiter Stichwort-Vorschlags-Katalog.

**Draußen (eigene Module / bestehende Funktionen):**
- **Mitglieder-/Einsatzleitungs-Verwaltung** bleibt bei der bestehenden Mitglieder-Funktion. Auf dieser Seite wird die Einsatzleitung nur **read-only** angezeigt (aus der Mitgliederliste abgeleitet).
- **Status-Wechsel/Abschließen** bleibt der bestehenden Abschließen-Aktion vorbehalten; hier nur Status-Anzeige.
- Einheiten, Personen, Lage(-karte), ETB, Einsatzabschnitte, Sanitätsdienst-Sonderblock (Veranstalter/Auftraggeber) — spätere, eigene Specs.

## Datenmodell

### Migration `0005_einsatzdaten.sql`

Neue Spalten auf `einsatz` (alle nullable außer `einsatzart`):

| Spalte | Typ | Bedeutung |
|---|---|---|
| `einsatzart` | `TEXT NOT NULL DEFAULT 'realeinsatz'`, CHECK in (`realeinsatz`, `uebung`, `sanitaetsdienst`, `bereitstellung`) | Grobklasse des Einsatzes |
| `einsatznummer_intern` | `TEXT` | Format `JJJJ-NNN`, beim Anlegen automatisch vorbelegt, danach editierbar. **Je Organisation eindeutig** (s. u.) |
| `angelegt_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | technischer Anlage-Zeitpunkt, **read-only** (Audit-Spur) |
| `leitstellen_nr` | `TEXT` | externe/Leitstellen-Einsatznummer |
| `einsatzort` | `TEXT` | Adresse (Freitext) |
| `einsatzort_lat` | `REAL` | optionale Koordinate (manuelle Eingabe) |
| `einsatzort_lon` | `REAL` | optionale Koordinate (manuelle Eingabe) |
| `meldende_stelle` | `TEXT` | wer hat alarmiert/angefordert |
| `sachverhalt` | `TEXT` | Meldebild/Lagebeschreibung (mehrzeilig) |
| `anzahl_betroffene_initial` | `INTEGER` | erste gemeldete Zahl Betroffener |

**Eindeutigkeit der Einsatznummer:** `CREATE UNIQUE INDEX ... ON einsatz(org_id, einsatznummer_intern)`. In SQLite gelten mehrere `NULL` als verschieden — Bestands-Einsätze ohne Nummer kollidieren also nicht. Eine manuell vergebene Dublette (oder eine Auto-Kollision) führt zu `Conflict` (409).

**Alarmzeit vs. Anlage-Zeit:** `begonnen_at` (Bestandsspalte) ist die **editierbare Alarmzeit/Einsatzbeginn**; `angelegt_at` (neu) ist der **read-only** technische Anlage-Zeitpunkt als Audit-Spur. Korrektur der Alarmzeit überschreibt also nicht den Original-Anlagezeitpunkt.

Bestandsdaten: `einsatzart` erhält per DEFAULT `'realeinsatz'`; `angelegt_at` wird für Bestands-Einsätze auf `begonnen_at` zurückgesetzt (nächste bekannte technische Zeit); alle übrigen neuen Spalten bleiben bei `NULL`. `einsatznummer_intern` für Bestands-Einsätze nicht rückwirkend vergeben (bleibt `NULL`, ist nachträglich editierbar).

### Migration `0006_stichwort_vorschlag.sql`

```sql
CREATE TABLE einsatz_stichwort_vorschlag (
    id        INTEGER PRIMARY KEY,
    org_id    INTEGER NOT NULL REFERENCES organisation(id),
    text      TEXT NOT NULL,
    sortier   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(org_id, text)
);
```

Seed einer Startliste je Organisation (z. B. `H1`, `H1Y`, `MANV`, `San-Dienst`, `Übung`). Die Combobox erlaubt unabhängig davon freie Eingabe.

### Typen

- **`src/einsatz/mod.rs`:** `Einsatz`-Struct (`sqlx::FromRow`), `EinsatzAnzeige` (`Serialize`) und `Einsatz::anzeige()` um die neuen Felder erweitern.
- **`frontend/src/api/types.ts`:** `EinsatzAnzeige`-Interface + neuer Typ `Einsatzart = 'realeinsatz' | 'uebung' | 'sanitaetsdienst' | 'bereitstellung'`; neues Interface `StichwortVorschlag { id; text }`.

## Backend

### `PATCH /api/einsaetze/{id}` (neu)

Aktualisiert die editierbaren Kopffelder in einem Request.

- **Gate (eigenes Gate dieser Route, ETB-Semantik bleibt unverändert):** Schreibrecht **oder** System-Admin — d. h. `fordere_schreibrecht(rolle)` (Einsatzleitung oder Führungspersonal) **ODER** `benutzer.system_rolle == admin` — **plus** `fordere_aktiv(einsatz)` (abgeschlossen → `Conflict` 409). Das bestehende `fordere_schreibrecht` (auch vom ETB genutzt) wird **nicht** verändert; die Admin-Erlaubnis sitzt lokal in dieser Route.
- **Editierbare Felder:** `bezeichnung`, `stichwort`, `einsatzart`, `einsatznummer_intern`, `leitstellen_nr`, `einsatzort`, `einsatzort_lat`, `einsatzort_lon`, `meldende_stelle`, `sachverhalt`, `anzahl_betroffene_initial`, `begonnen_at` (Alarmzeit).
- **Nicht editierbar hier:** `status`, `abgeschlossen_at`, `abgeschlossen_von` (Abschließen-Aktion), `angelegt_at` (Audit), `org_id`, `id`.
- **Eindeutigkeit:** Verstoß gegen den Unique-Index auf `einsatznummer_intern` → `Conflict` (409) mit klarer Meldung.
- **Update-Semantik:** Das Formular sendet bei jedem Speichern **alle** editierbaren Felder (Vollersatz der editierbaren Spalten); nicht-editierbare Spalten bleiben unberührt. Leere Optional-Strings → `NULL`. Kein partielles Patchen einzelner Felder — das passt zum Lesemodus-/Bearbeiten-Workflow (ein atomares Speichern).
- **Validierung:** `bezeichnung` getrimmt nicht leer; `einsatzart` ∈ Enum; `anzahl_betroffene_initial` ≥ 0 oder `NULL`; `begonnen_at` parsebares Datum/Zeit im DB-Format; leere Optional-Strings → `NULL`.
- **Antwort:** aktualisierte `EinsatzAnzeige` (wie `detail`).

### Einsatznummer-Auto-Vergabe

In `repo::anlegen`: `einsatznummer_intern = JJJJ-NNN`, wobei `NNN` je Organisation und Jahr fortlaufend ist (z. B. höchste vorhandene Nummer des Jahres + 1, 3-stellig nullgepaddet). Vergabe beim Anlegen; bleibt danach manuell editierbar.

### Stichwort-Vorschläge (org-weit)

- `GET /api/stichwort-vorschlaege` — alle eingeloggten Nutzer (für die Combobox), gefiltert auf die eigene Organisation, sortiert nach `sortier`, dann `text`.
- `POST /api/stichwort-vorschlaege` — nur System-Admin; legt Vorschlag an (Duplikat je Orga → `Conflict`).
- `DELETE /api/stichwort-vorschlaege/{id}` — nur System-Admin; löscht Vorschlag.

Neues Routen-Modul `src/routes/stichwort.rs` + Registrierung in `src/routes/mod.rs`. Repo-Funktionen analog zum bestehenden Stil.

## Frontend

### `pages/EinsatzdatenPage.tsx` (neu)

- In `App.tsx` als echtes Modul-Element für Key `einsatzdaten` registrieren (ersetzt den `ModulStub`):
  ```tsx
  const MODUL_ELEMENTE = { etb: <EtbPage />, einsatzdaten: <EinsatzdatenPage /> };
  ```
- In `frontend/src/einsatz/modulRegistry.ts` den Eintrag `einsatzdaten` von `status: 'geplant'` auf `status: 'fertig'` setzen (damit das Modul-Panel es als fertig markiert).
- Lädt den Einsatz über `useQuery(['einsatz', einsatzId])` (geteilter Cache mit `EinsatzLayout`) und die Mitglieder über `ladeMitglieder` (für die read-only Einsatzleitungs-Anzeige).
- **Lesemodus:** antd `Descriptions` mit allen Feldern; leere Felder als „—". Einsatzleitung aus Mitgliedern mit Rolle `einsatzleitung`. Status-Badge. `begonnen_at` (Alarmzeit) und `angelegt_at` (Anlage-Zeit, read-only) beide ausgewiesen.
- **Bearbeiten:** Button nur sichtbar, wenn `meine_rolle` schreibberechtigt (Leitung/Führung) **oder** System-Admin **und** Einsatz aktiv. Klick → antd `Form` mit den editierbaren Feldern, Speichern/Abbrechen.
  - Stichwort: `AutoComplete` (oder `Select` mit `showSearch`, freie Eingabe erlaubt), Optionen aus `GET /api/stichwort-vorschlaege`.
  - Einsatzart: `Select` mit den vier Werten (deutsche Labels).
  - `begonnen_at`: `DatePicker` mit Uhrzeit.
  - Koordinate: zwei `InputNumber` (Lat/Lon), optional.
  - Anzahl Betroffene: `InputNumber` ≥ 0.
- Nach erfolgreichem Speichern: `queryClient.invalidateQueries({ queryKey: ['einsatz', einsatzId] })` → Header-Switcher-Name aktualisiert sich mit.

### `pages/StammdatenPage.tsx` (erweitern)

Aus dem reinen Platzhalter wird eine Seite mit einem Abschnitt **„Einsatz-Stichworte"**:
- Liste der Vorschläge (`GET`), je Eintrag löschbar (Admin), Eingabefeld + „Hinzufügen" (Admin). Für Nicht-Admins read-only.
- Darunter bleibt der bestehende Platzhalter-Hinweis für die noch fehlenden Stammdaten-Bereiche (Personal, Fahrzeuge, Einheiten).

### API-Module

- `api/einsaetze.ts`: neue Funktion `aktualisiereEinsatz(id, felder)` → `PATCH /api/einsaetze/{id}`.
- `api/stichwortVorschlaege.ts` (neu): `listeStichwortVorschlaege()`, `legeStichwortVorschlagAn(text)`, `loescheStichwortVorschlag(id)`.

## Tests

### Backend
- PATCH-Berechtigung: Einsatzleitung ✓, Führungspersonal ✓, System-Admin (auch ohne Mitgliedschaft) ✓, Beobachter → `Forbidden`, Nicht-Mitglied ohne Admin → `Forbidden`. ETB-Schreibrecht bleibt unverändert (Admin ohne Mitgliedschaft darf ETB **nicht** schreiben).
- PATCH auf abgeschlossenen Einsatz → `Conflict` (409).
- Validierung: leere `bezeichnung` → `Validation`; ungültige `einsatzart` → `Validation`; negative `anzahl_betroffene_initial` → `Validation`; leere Optionals werden `NULL`. `angelegt_at` bleibt durch PATCH unverändert.
- Einsatznummer-Auto-Vergabe: erster Einsatz des Jahres → `JJJJ-001`, nächster → `JJJJ-002`; je Organisation getrennt.
- Einsatznummer-Eindeutigkeit: PATCH auf eine in derselben Orga bereits vergebene Nummer → `Conflict` (409); mehrere `NULL` erlaubt.
- Stichwort-Vorschläge: `GET` für alle, `POST`/`DELETE` nur Admin (sonst `Forbidden`), Duplikat → `Conflict`.

### Frontend
- Lesemodus rendert alle Felder; leere Felder als „—".
- Bearbeiten-Button nur bei Schreibrecht **und** aktivem Einsatz; Beobachter und abgeschlossener Einsatz: kein Button, reine Anzeige.
- Stichwort-Combobox zeigt geladene Vorschläge und erlaubt freie Eingabe.
- Speichern ruft PATCH und invalidiert `['einsatz', id]`.
- Stammdaten-Abschnitt: Admin sieht Hinzufügen/Löschen, Nicht-Admin read-only.
- **Regression:** bestehende `EinsaetzePage`-/`EtbPage`-Tests bleiben grün; Pfad `/einsaetze/:id/einsatzdaten` rendert jetzt die echte Seite statt des Stubs.

## Offene Punkte / Folge-Specs

- Sanitätsdienst-Sonderblock (Auftraggeber/Veranstalter, geplanter Zeitraum, Treffpunkt/-zeit) — eigene Spec, eingeblendet bei `einsatzart = sanitaetsdienst`.
- Karten-Picker für die Koordinate — im Lage-Modul.
- Strukturierter Stichwort-Katalog mit Sortier-/Bearbeiten-UI über das simple Hinzufügen/Löschen hinaus — bei Bedarf später.
