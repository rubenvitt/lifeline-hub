# Design: Schnellbausteine (vordefinierte ETB-Textbausteine)

**Task:** LFH-42
**Datum:** 2026-06-02
**Status:** Spec (Brainstorming abgeschlossen, freigegeben)

## Ziel

Die ETB-Erfassung beschleunigen, indem wiederkehrende Einträge als vordefinierte
**Schnellbausteine** mit einem Klick in die Schnellerfassung übernommen werden.
Ein Baustein ist eine **Eintrags-Vorlage**: er belegt Typ und Inhaltstext (optional
auch Meldeweg/Veranlassung). Der Inhaltstext darf **Platzhalter** enthalten, die beim
Einsetzen aufgelöst werden — teils automatisch aus dem Einsatzkontext, teils per
Ausfüll-Dialog.

## Scope-Entscheidungen (v1)

| Entscheidung | Festlegung |
|---|---|
| Geltungsbereich | **Org-global** (Org-Admin gepflegt, gilt für alle Einsätze der Org). Einsatzlokale Bausteine sind bewusst v2. |
| Was belegt ein Baustein | **Vorlage**: `typ` + `inhalt` (+ optional `meldeweg`, `veranlassung`). `von`/`an` bewusst nicht (situationsspezifisch). |
| Platzhalter | **In v1 enthalten.** |
| Platzhalter-Befüllung | **Manuell + Auto-Kontext**: Whitelist-Platzhalter werden automatisch aus `EinsatzAnzeige` + Uhr aufgelöst, der Rest per Ausfüll-Dialog. |
| Verwaltung | `AdminUser` (Org-Admin) — wie alle bestehenden Kataloge. |
| Nutzung (Einsetzen) | Schreibberechtigte (`einsatzleitung`/`fuehrungspersonal`, Einsatz `aktiv`). |

## Architektur in einem Satz

Org-globaler Katalog `etb_baustein` (exakt nach bestehendem Stammdaten-Muster:
`org_id`-scoped, `AdminUser`-CRUD, Soft-Delete) **+** eine rein **client-seitige
Platzhalter-Engine**, die beim Einsetzen die Felder der Schnellerfassung vorbefüllt.
Das Backend bleibt ein „dummer" Katalog und kennt keine Platzhalter-Logik.

## 1. Datenmodell — `migrations/0036_etb_baustein.sql`

Tabelle `etb_baustein` (org-globaler Katalog):

| Spalte | Typ | Anmerkung |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `org_id` | INTEGER NOT NULL, FK `organisation(id)` | org-global, kein `einsatz_id` |
| `label` | TEXT NOT NULL | Anzeigename, z. B. „Lage unverändert" |
| `typ` | TEXT NOT NULL | `CHECK (typ IN ('meldung','anordnung','lage','entscheidung'))` — nur `ERFASSBARE_TYPEN`, **kein** `system`/`berichtigung` |
| `inhalt` | TEXT NOT NULL | Vorlagentext, darf Platzhalter `{…}` enthalten |
| `meldeweg` | TEXT NULL | optional vorbelegt; `CHECK (meldeweg IS NULL OR meldeweg IN ('funk','telefon','persoenlich','sonstige'))` |
| `veranlassung` | TEXT NULL | optional, darf ebenfalls Platzhalter enthalten |
| `sortier` | INTEGER NOT NULL DEFAULT 0 | Reihenfolge im Picker |
| `aktiv` | INTEGER NOT NULL DEFAULT 1 | Soft-Delete |
| `erstellt_at` | TEXT NOT NULL | |
| `aktualisiert_at` | TEXT NOT NULL | |

- `UNIQUE(org_id, label)` — verhindert Dubletten org-weit (Soft-Delete-Hinweis: siehe Offene Punkte).
- Index auf `(org_id, aktiv, sortier)` für die Picker-Liste.
- **Seed pro Org via CROSS JOIN** (wie `0006_stichwort_vorschlag.sql` / `0008_fahrzeug_status.sql`):
  einige BOS-Defaults, z. B.:
  - „Lage unverändert" → typ `lage`, inhalt „Lage unverändert."
  - „Erkundung eingeleitet" → typ `meldung`, inhalt „Erkundung durch {einheit} eingeleitet."
  - „Einheit eingetroffen" → typ `meldung`, inhalt „{einheit} um {uhrzeit} an Einsatzstelle eingetroffen."

## 2. Platzhalter-Engine (Frontend, pur & unit-testbar)

Datei: `frontend/src/etb/bausteinEinsetzen.ts` — reine Funktionen, kein React, kein I/O.

- **Syntax:** `{name}`, erkannt per Regex `/\{([a-z0-9_]+)\}/g`. Alles, was nicht matcht
  (z. B. literale `{` ohne gültiges Token), bleibt unverändert.
- **Auto-Kontext-Whitelist** — still aufgelöst aus `EinsatzAnzeige` + Uhr:
  | Platzhalter | Quelle |
  |---|---|
  | `{datum}` | aktuelles Datum (lokal, `dayjs().format('DD.MM.YYYY')`) |
  | `{uhrzeit}` | aktuelle Uhrzeit (`dayjs().format('HH:mm')`) |
  | `{einsatzort}` | `einsatz.einsatzort` |
  | `{stichwort}` | `einsatz.stichwort` |
  | `{einsatz}` | `einsatz.bezeichnung` |
  | `{einsatznr}` | `einsatz.leitstellen_nr` |
- **Manuelle Platzhalter:** alles, was nicht in der Whitelist steht (z. B. `{einheit}`,
  `{abschnitt}`).
- **Fallback:** ist ein Auto-Wert leer/`null` (z. B. `einsatzort` nicht gesetzt), wird der
  Platzhalter zum **manuellen** Feld herabgestuft (erscheint im Ausfüll-Dialog).
- **API der Engine:**
  - `ermittlePlatzhalter(baustein, einsatz): string[]` — Liste der noch manuell
    auszufüllenden Platzhalter-Namen (eindeutig, in Vorkommens-Reihenfolge), inkl.
    herabgestufter Auto-Platzhalter mit fehlendem Wert.
  - `setzeBausteinEin(baustein, einsatz, manuelleWerte): { typ, inhalt, meldeweg?, veranlassung? }`
    — substituiert alle Platzhalter (Auto + manuell) in `inhalt` und `veranlassung` und
    liefert die zu setzenden Formularfelder.
  - Nicht ausgefüllter manueller Platzhalter → leerer String (der Erfasser sieht den
    vorbefüllten Text vor dem Absenden ohnehin und kann korrigieren).

## 3. Einsetz-UX in der Schnellerfassung

```
[ Baustein einsetzen ▾ ]   ← Dropdown/Select über dem typ-Feld
   sichtbar nur wenn: darfSchreiben && !berichtigungZu
   └ Auswahl eines Bausteins
       ├ keine manuellen Platzhalter → Felder sofort setzen
       └ manuelle Platzhalter        → kleiner Modal: ein Eingabefeld je
                                        Platzhalter → „Einsetzen" → Felder setzen
```

- Gesetzt werden via `form.setFieldsValue`: `typ`, `inhalt` (substituiert),
  sowie `meldeweg`/`veranlassung`, falls im Baustein hinterlegt.
- **Bereits gefüllter Inhalt:** ist `inhalt` nicht leer → `Popconfirm`
  „Vorhandenen Inhalt ersetzen?" (Default: ersetzen). Andernfalls direkt setzen.
- **Berichtigungs-Modus:** Picker komplett ausgeblendet — dort ist `typ` auf
  `berichtigung` erzwungen, ein Vorlage-`typ` würde kollidieren.
- **Edge-Cases (in Engine-Tests abgedeckt):** unausgefüllter Platzhalter, literale
  `{`/`}` im Freitext, fehlender Auto-Wert (Herabstufung zu manuell).

## 4. Berechtigungen (sauber getrennt)

- **Verwalten (CRUD):** `AdminUser` (Org-Admin) — identisch zu allen bestehenden Katalogen.
- **Nutzen (Liste lesen + einsetzen):** Schreibberechtigte
  (`einsatzleitung`/`fuehrungspersonal`, Einsatz `aktiv`). Liste GET ist org-scoped via
  `CurrentUser`; die Schnellerfassung wird ohnehin nur Schreibberechtigten gerendert.

## 5. Backend-Komponenten (nach bestehendem Katalog-Muster)

- `src/baustein/mod.rs` — Modell (`EtbBaustein`, `NeuerBaustein`, `BausteinUpdate`) +
  Validierungs-Helfer (`typ ∈ ERFASSBARE_TYPEN`, `meldeweg` gültig, `label`/`inhalt`
  nicht-leer nach Trim).
- `src/baustein/repo.rs` — `liste(pool, org_id)`, `anlegen(pool, org_id, daten)`,
  `aktualisiere(pool, org_id, id, daten)`, `deaktiviere(pool, org_id, id)`; alle
  `org_id`-gescoped (`WHERE org_id = ?`).
- `src/routes/etb_baustein.rs` — Handler:
  - `GET /api/etb-bausteine` → `liste` (CurrentUser, org aus Benutzer)
  - `POST /api/etb-bausteine` → `anlegen` (AdminUser)
  - `PATCH /api/etb-bausteine/{id}` → `aktualisiere` (AdminUser)
  - `POST /api/etb-bausteine/{id}/deaktivieren` → `deaktiviere` (AdminUser)
  - Validierung im Handler vor Repo-Aufruf; `409` bei Label-Konflikt, `404` bei
    unbekannter ID, `422` bei ungültigem `typ`/`meldeweg`.
- Wiring der Routes in `src/app.rs` (bei den übrigen Katalog-Routes).

## 6. Frontend-Komponenten

- `frontend/src/api/etbBaustein.ts` — Typen (`EtbBaustein`, `NeuerBaustein`,
  `BausteinUpdate`) + CRUD-Calls (`listeBausteine`, `legeBausteinAn`,
  `aktualisiereBaustein`, `deaktiviereBaustein`).
- `frontend/src/stammdaten/EtbBausteineTab.tsx` — Admin-CRUD-Tab: Liste + Modal-Form
  (`label`, `typ`, `inhalt`, `meldeweg`, `veranlassung`), Soft-Delete-Toggle.
  Folgt `MaterialTab.tsx`/`PersonalStatusTab.tsx` (react-query + Modal-Form).
- `frontend/src/etb/bausteinEinsetzen.ts` — Platzhalter-Engine (siehe §2).
- `frontend/src/etb/BausteinPicker.tsx` — Dropdown + Ausfüll-Dialog (Modal) für die
  Einsetz-UX (§3).
- Integration:
  - `Schnellerfassung.tsx` — neue Props `bausteine: EtbBaustein[]` und
    `einsatz: EinsatzAnzeige`; rendert `BausteinPicker` (nur wenn `!berichtigungZu`).
  - `EtbPage.tsx` — lädt Bausteine via `useQuery(['etb-bausteine'])` und reicht
    `einsatz` + `bausteine` an `Schnellerfassung` durch.

## 7. Tests

- **Backend** `tests/etb_baustein.rs`:
  - Seed liefert erwartete Default-Bausteine pro Org.
  - Admin-CRUD (anlegen/aktualisieren/deaktivieren), Nicht-Admin nur lesen.
  - **Org-Isolation**: Org A sieht/ändert keine Bausteine von Org B.
  - `typ`-Validierung: `system`/`berichtigung` werden abgelehnt (`422`).
  - Label-Konflikt → `409`; unbekannte ID → `404`.
  - Soft-Delete: deaktivierte Bausteine erscheinen nicht in der Liste.
- **Frontend**:
  - `bausteinEinsetzen.test.ts` — Auto-Kontext-Auflösung, manuelle Platzhalter,
    Missing-Fallback (Herabstufung), literale Klammern, Substitution in
    `inhalt` **und** `veranlassung`.
  - `BausteinPicker.test.tsx` — Auswahl ohne Platzhalter setzt Felder sofort;
    Auswahl mit manuellen Platzhaltern öffnet Dialog; Replace-Confirm bei gefülltem
    `inhalt`; Picker im Berichtigungs-Modus ausgeblendet.
  - `EtbBausteineTab.test.tsx` — Liste rendert, Anlegen/Bearbeiten via Modal,
    Admin-Gating der Aktionen.

## Nicht-Ziele (v2+)

- Einsatzlokale Bausteine (eigener `einsatz_id`-Scope).
- Pflege durch Einsatzleitung (statt nur Org-Admin).
- Auto-Kontext über die Whitelist hinaus (z. B. eigene Einheit, Funkrufname).
- Kategorien/Gruppierung von Bausteinen.

## Offene Punkte / bewusste Festlegungen

- **Soft-Delete vs. `UNIQUE(org_id, label)`:** Ein deaktivierter Baustein belegt das
  Label weiterhin. Festlegung v1: Reaktivieren statt Neu-Anlegen bei Label-Kollision
  ist v2; in v1 führt ein Label-Konflikt mit einem (auch deaktivierten) Baustein zu
  `409`. → In `writing-plans` als konkreter Schritt zu präzisieren.
