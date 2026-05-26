# K&M‑1 — Stammdaten & Disposition (am Beispiel Fahrzeuge)

**Datum:** 2026-05-26
**Status:** Design abgestimmt, bereit für Implementierungsplan
**Teilprojekt:** 2 „Kräfte & Mittel" — Spec 1 von 4 (Unterbau; legt das Dispositions-Pattern, das K&M‑2 Personal, K&M‑3 Einheiten, K&M‑4 Material wiederverwenden).
**Vorgänger:** [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) — definiert das Modul-Gerüst; „Fahrzeuge" ist dort Kategorie *Kräfte & Mittel*, Status `geplant` (heute `ModulStub`). Tragendes Konzept dort: globaler Stamm-Pool → Disposition in den Einsatz + Ad-hoc-externe Kräfte.

## Problem

Die Kategorie „Kräfte & Mittel" besteht heute nur aus `ModulStub`-Platzhaltern, und es gibt **keinen globalen Ressourcen-Stamm** außer dem org-weiten Stichwort-Vorschlags-Katalog. Damit Fahrzeuge (und später Personal, Einheiten, Material) im Einsatz nutzbar werden, fehlt der gesamte Unterbau:

1. ein **org-weiter Fahrzeug-Stamm** (Fuhrpark der Organisation),
2. die **Disposition** — Auswahl/Aktivierung von Stamm-Fahrzeugen in einen konkreten Einsatz, plus **Ad-hoc-externe** Fahrzeuge (z. B. Feuerwehr, Mutual Aid), die nicht im Stamm stehen,
3. ein **operativer Status** je disponiertem Fahrzeug.

Diese Spec baut den Unterbau **generisch** und zieht ihn **konkret für Fahrzeuge** durch. Fahrzeuge ist die erste echte globale Stamm-Entity des Produkts; das hier gewählte Pattern ist für K&M‑2/3/4 bindend.

## Recherche-Grundlage (warum diese Felder, dieser Status, diese Stärke)

Konsolidiert aus BOS-Doktrin (FwDV 3, DV 100, FMS-Funkmeldesystem) und realen Systemen (DIVERA 24/7, FeuerSoftware Connect, iSE-COBRA/EDP, HiOrg-Server, Fireboard, Command X). Reale Systeme trennen **Disposition** (was Leitstelle/Einsatzleitung zum Führen braucht) von **Fuhrparkverwaltung** (Wartung, Papiere) — für dieses Produkt zählt nur die Dispositionsseite.

- **Fahrzeug-Identität** im Funk/Lagebild = Funkrufname + Fahrzeugtyp; rechtlich/abrechnungsrelevant + eindeutig = Kennzeichen; Digitalfunk = OPTA und (technisch) FMS-/ISSI-Kennung.
- **Multi-HiOrg-Markt:** das Produkt bedient weiße HiOrgs **und** FW-nahe BOS, und die Disposition kennt externe Kräfte → **Trägerorganisation** ist ein Kern-Filterkriterium, kein Kür.
- **FMS-Status (0–9)** ist der Standard für den operativen Fahrzeugstatus; weiße HiOrgs nutzen ihn im Rettungsdienst (heute via Digitalfunk-SDS). Die Bedeutungen jenseits 1–6 variieren je Bundesland/Kreisverband — ein **starres Enum verbietet sich**.
- **Taktische Stärke** (FwDV 3 / DV 100): 4-stellig `Führer / Unterführer / Mannschaft / Gesamt`, Gesamt = Summe der ersten drei. Standardwerte: Trupp `0/0/2/2`, Staffel `0/1/5/6`, Gruppe `0/1/8/9`, Zug `1/3/18/22`.

## Abgestimmte Entscheidungen

1. **Dispositions-Modell = Referenz + Einsatz-Zustand** (nicht Voll-Snapshot, nicht Stamm-Versionierung). Die Dispositionszeile verweist auf `fahrzeug.id`; aktiver Einsatz zeigt den **aktuellen** Stamm-Stand. Nachvollziehbarkeit über zwei Mechanismen statt Versionierung.
2. **Kein Hard-Delete im Stamm.** Fahrzeuge werden nie gelöscht, nur auf `dienststatus = ausser_dienst` gesetzt → Referenzen aus (auch abgeschlossenen) Einsätzen bleiben immer auflösbar.
3. **Identitäts-Schnappschuss** in jeder Dispositionszeile: **Funkrufname + Kennzeichen + Fahrzeugtyp + OPTA** zum Dispo-Zeitpunkt eingefroren. Beantwortet „welches Fahrzeug war das" auch nach späteren Stamm-Änderungen. Bei **Ad-hoc-externen** Fahrzeugen *sind* diese Felder die eigentlichen Daten (keine Stamm-Referenz).
4. **ETB als Historie:** Dispositions- und Status-Ereignisse werden zusätzlich als **ETB-Einträge** mitgeschrieben (inkl. Fahrzeug-Identität). Das ist die unveränderliche, append-only Spur — und macht das ETB selbsttragend für die spätere Retention-Idee (ETB + PDF-Report).
5. **Einsatz-Status = admin-konfigurierbarer Katalog**, kein festes Enum. Je Eintrag: `label`, `sortier`, optional `farbe`, optional `fms_anker` (0–9) — **plus eine feste Semantik-Kategorie** (`verfuegbar` / `gebunden` / `nicht_verfuegbar`), an der die App-Logik (Verfügbarkeit) hängt. Geseedete Default-Liste, vom Admin umbenenn-/erweiter-/sortierbar; nicht hart löschbar (deaktivieren).
6. **Funk-Anbindung:** MVP rein in-app (kein Funk-/Leitstellen-Gateway). `fms_anker` + `fms_issi` sind die Zukunfts-Haken; ein späterer Umstieg auf reines FMS 1–9 bleibt ein reines Mapping, kein Bruch.
7. **Taktische Stärke** als wiederverwendbarer Typ `Staerke` (drei Werte F/UF/M, Gesamt berechnet). Beim Fahrzeug = optionale Sollbesatzung. Die Ist-Stärke-Feinheit („0 = unbesetzt" vs. „– = nicht vorgesehen") brauchen erst spätere Stärkemeldungen, **nicht** K&M‑1.
8. **Schreibrechte:** Fahrzeug-Stamm + Status-Katalog → **System-Admin** (globaler Stammdaten-Bereich). Disponieren/Status-Setzen/Ad-hoc im Einsatz → **Einsatzleitung + Führungspersonal**; Beobachter nur lesend; **abgeschlossener Einsatz = read-only** (`fordere_aktiv`).
9. **Abrollbehälter gestrichen** — keine eigene Entity; der bestehende `modulRegistry`-Eintrag `abrollbehaelter` wird entfernt (bei Bedarf später wieder aufnehmbar).

## Scope-Abgrenzung

**Drin:**
- Globaler **Fahrzeug-Stamm** (CRUD, Soft-Delete) im Stammdaten-Bereich.
- Org-weiter **Fahrzeug-Status-Katalog** (CRUD, Deaktivieren) im Stammdaten-Bereich.
- **Disposition** im Einsatz-Modul „Fahrzeuge": Stamm-Fahrzeuge zuordnen, Ad-hoc-externe anlegen, Status setzen, entfernen — mit Identitäts-Schnappschuss und ETB-Eintrag.
- Wiederverwendbarer **`Staerke`**-Typ (hier: Fahrzeug-Sollbesatzung).

**Draußen (eigene/spätere Specs oder bestehende Funktionen):**
- **Zuordnung zu Einsatzabschnitten** — kommt mit Einheiten/Einsatzabschnitten (K&M‑3 / Führung).
- **Personal, Einheiten, Material** — eigene K&M-Specs; verwenden dieses Pattern.
- **Echte Funk-/Leitstellen-Bridge**, GPS-Live-Tracking, Beladungs-/Ausstattungslisten, Fuhrpark-Daten (HU, Baujahr, zGG).
- **SSE-Live-Aktualisierung der Dispositions-Liste** über Clients hinweg — Folge (siehe Offene Punkte); Änderungen spiegeln sich vorerst über Refetch/Invalidierung und über die ETB-Einträge (die bereits live sind).
- **Daten-Retention abgeschlossener Einsätze** (ETB + PDF-Report) — querschnittliche Folge-Spec.

## Datenmodell

### Migration `0007_fahrzeug.sql` — Fahrzeug-Stamm (global, org-weit)

```sql
CREATE TABLE fahrzeug (
    id                   INTEGER PRIMARY KEY,
    org_id               INTEGER NOT NULL REFERENCES organisation(id),
    funkrufname          TEXT NOT NULL,
    fahrzeugtyp          TEXT,                       -- Combobox; Vorschläge abgeleitet (DISTINCT, s. Backend)
    traegerorganisation  TEXT,                       -- frei; UI default = Name der eigenen Org
    kennzeichen          TEXT,
    opta                 TEXT,
    standort             TEXT,                       -- Freitext (echter Standort-Stamm später)
    fms_issi             TEXT,                       -- Digitalfunk-Kennung (Zukunfts-Haken)
    sondersignal         INTEGER NOT NULL DEFAULT 0, -- 0/1: Sonder-/Wegerecht
    tragenkapazitaet     INTEGER,                    -- optional, San-Typen
    staerke_fuehrer      INTEGER,                    -- Sollbesatzung (taktische Stärke), optional
    staerke_unterfuehrer INTEGER,
    staerke_mannschaft   INTEGER,
    bemerkung            TEXT,
    dienststatus         TEXT NOT NULL DEFAULT 'in_dienst'
                         CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Funkrufname je Organisation eindeutig, aber nur unter aktiven Fahrzeugen:
-- außer Dienst gestellte geben ihren Namen zur Wiederverwendung frei.
CREATE UNIQUE INDEX idx_fahrzeug_funkrufname
    ON fahrzeug(org_id, funkrufname) WHERE dienststatus = 'in_dienst';
```

- **Funkrufname je Organisation eindeutig unter aktiven Fahrzeugen** (partieller Unique-Index `WHERE dienststatus = 'in_dienst'`). Dublette → `Conflict` (409). Außer Dienst gestellte Fahrzeuge **geben ihren Funkrufnamen frei** (reale Fuhrparks recyceln Namen); ein Reaktivieren auf einen inzwischen aktiv vergebenen Namen → `Conflict`.
- **Soll-Stärke**: drei nullable Integer; Gesamt wird berechnet, nicht gespeichert. Validierung: alle drei gesetzt oder alle drei `NULL`; Werte ≥ 0.
- **Soft-Delete**: kein DELETE; „löschen" = `dienststatus = ausser_dienst`. Außer-Dienst-Fahrzeuge erscheinen nicht in der Dispositions-Auswahl, bleiben aber referenzierbar.

### Migration `0008_fahrzeug_status.sql` — Status-Katalog (org-weit, admin-pflegbar)

```sql
CREATE TABLE fahrzeug_status (
    id        INTEGER PRIMARY KEY,
    org_id    INTEGER NOT NULL REFERENCES organisation(id),
    label     TEXT NOT NULL,
    kategorie TEXT NOT NULL
              CHECK (kategorie IN ('verfuegbar', 'gebunden', 'nicht_verfuegbar')),
    farbe     TEXT,                        -- optional, Hex (#rrggbb) für Lageübersicht
    fms_anker INTEGER CHECK (fms_anker BETWEEN 0 AND 9),  -- optional
    sortier   INTEGER NOT NULL DEFAULT 0,
    aktiv     INTEGER NOT NULL DEFAULT 1,  -- Soft-Delete (deaktiviert, statt löschen)
    UNIQUE(org_id, label)
);
```

**Seed-Default je Organisation** (analog zur Stichwort-Vorschlags-Seedung im Admin-Bootstrap `src/auth/bootstrap.rs`; die Migration seedet zusätzlich die bereits bestehende Organisation):

| label | kategorie | fms_anker | sortier |
|---|---|---|---|
| einsatzbereit | `verfuegbar` | 1 | 10 |
| disponiert | `gebunden` | 3 | 20 |
| anfahrt | `gebunden` | 3 | 30 |
| vor_ort | `gebunden` | 4 | 40 |
| transport | `gebunden` | 7 | 50 |
| am_ziel | `gebunden` | 8 | 60 |
| zurück | `gebunden` | 1 | 70 |
| außer Dienst | `nicht_verfuegbar` | 6 | 80 |

Der Admin kann Labels umbenennen, neue Stati ergänzen, Reihenfolge/Farbe ändern. Die **Kategorie** bleibt das, woran der Code Verfügbarkeit erkennt.

### Migration `0009_einsatz_fahrzeug.sql` — Disposition (pro Einsatz)

```sql
CREATE TABLE einsatz_fahrzeug (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id),
    fahrzeug_id     INTEGER REFERENCES fahrzeug(id),         -- NULL = Ad-hoc extern
    status_id       INTEGER REFERENCES fahrzeug_status(id),  -- aktueller Einsatz-Status
    -- Identitäts-Schnappschuss (eingefroren beim Disponieren);
    -- bei Ad-hoc-extern sind dies die eigentlichen Daten:
    snap_funkrufname         TEXT NOT NULL,
    snap_kennzeichen         TEXT,
    snap_fahrzeugtyp         TEXT,
    snap_opta                TEXT,
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id),
    UNIQUE(einsatz_id, fahrzeug_id)   -- ein Stamm-Fahrzeug je Einsatz nur einmal; mehrere NULL erlaubt
);
```

- **`snap_*`** dient doppelt: Identitäts-Schnappschuss für Stamm-Fahrzeuge **und** Datenträger für Ad-hoc-externe (dort `fahrzeug_id IS NULL`).
- **`UNIQUE(einsatz_id, fahrzeug_id)`**: dasselbe Stamm-Fahrzeug nicht doppelt im selben Einsatz; SQLite behandelt mehrere `NULL` als verschieden → beliebig viele Ad-hoc-Zeilen erlaubt.
- **Status beim Disponieren**: `status_id` auf den ersten aktiven Status der Kategorie `gebunden` gesetzt — **deterministisch nach `sortier`, dann `id`** (i. d. R. „disponiert"); fehlt ein solcher, bleibt `NULL` und wird in der UI gewählt.
- **Anzeige-Auflösung**: Bei `fahrzeug_id` gesetzt **und** Einsatz aktiv → Live-Felder aus `fahrzeug` (Korrekturen sofort sichtbar). Sonst (Ad-hoc, Stamm außer Dienst, abgeschlossener Einsatz) → `snap_*`. Der Listen-Endpunkt liefert beides; die UI wählt nach dieser Regel.

### Typen (`src/fahrzeug/mod.rs`, neu)

- `Fahrzeug` (`sqlx::FromRow`), `FahrzeugAnzeige` (`Serialize`).
- `FahrzeugStatus` (Katalog-Eintrag), `StatusKategorie`-Enum.
- `Staerke { fuehrer: u16, unterfuehrer: u16, mannschaft: u16 }` mit `gesamt()` und `anzeige() -> "1/3/18/22"` (`u16`, damit auch ein Verband/Stab über 255 nicht anstößt). Wiederverwendbar (eigenes kleines Modul `src/staerke.rs` oder in `fahrzeug`, im Plan zu entscheiden — Ziel: K&M‑2/3 importieren denselben Typ).
- `EinsatzFahrzeugAnzeige` (`Serialize`): aufgelöste Sicht inkl. Status (label/kategorie/farbe) und der nach obiger Regel gewählten Identität.

### Frontend-Typen (`frontend/src/api/types.ts`)

`Fahrzeug`, `FahrzeugStatus`, `StatusKategorie = 'verfuegbar' | 'gebunden' | 'nicht_verfuegbar'`, `Dienststatus = 'in_dienst' | 'ausser_dienst'`, `Staerke`, `EinsatzFahrzeug`.

## Backend

Neues Domänen-Modul `src/fahrzeug/` (`mod.rs`, `repo.rs`) analog `src/einsatz/`, `src/stichwort/`. Neue Routen-Module + Registrierung in `src/routes/mod.rs`.

### Globaler Fahrzeug-Stamm — `src/routes/fahrzeug.rs`

- `GET /api/fahrzeuge` — alle eingeloggten Nutzer (Lesen), eigene Organisation, sortiert nach Funkrufname; Query-Param `?nur_im_dienst=true` für die Dispositions-Auswahl.
- `GET /api/fahrzeug-typen` — abgeleitete Typ-Vorschläge für die AutoComplete (`SELECT DISTINCT fahrzeugtyp … WHERE org_id = ? AND fahrzeugtyp IS NOT NULL`), eigene Org. Kein eigener Stamm/keine eigene Tabelle — die Liste wächst organisch mit dem Bestand.
- `POST /api/fahrzeuge` — **Admin** (`AdminUser`). Validierung: `funkrufname` getrimmt nicht leer; Stärke vollständig oder leer; Dublette Funkrufname → `Conflict`.
- `PATCH /api/fahrzeuge/{id}` — **Admin**. Vollersatz der editierbaren Felder (Lesemodus/Bearbeiten-Workflow wie Einsatzdaten). Funkrufname-Dublette → `Conflict`.
- `POST /api/fahrzeuge/{id}/ausser-dienst` und `.../in-dienst` — **Admin**. Setzt `dienststatus` (Soft-Delete). Kein DELETE.

### Status-Katalog — `src/routes/fahrzeug_status.rs`

- `GET /api/fahrzeug-status` — alle eingeloggten Nutzer (für Dropdowns), eigene Org, nur `aktiv`, nach `sortier`.
- `POST /api/fahrzeug-status` — **Admin**. `label` nicht leer; `kategorie` ∈ Enum; `fms_anker` 0–9 oder leer; Dublette `label` → `Conflict`.
- `PATCH /api/fahrzeug-status/{id}` — **Admin**. label/kategorie/farbe/fms_anker/sortier.
- `POST /api/fahrzeug-status/{id}/deaktivieren` — **Admin**. `aktiv = 0` statt Löschen (referenzierte Dispositionen bleiben gültig).

### Disposition im Einsatz — `src/routes/einsatz_fahrzeug.rs`

Gate für alle schreibenden Routen: `fordere_schreibrecht(meine_rolle)` (Einsatzleitung/Führungspersonal) **und** `fordere_aktiv(einsatz)`. Lesen: `fordere_lesezugriff`.

- `GET /api/einsaetze/{id}/fahrzeuge` — disponierte Fahrzeuge des Einsatzes (aufgelöste Anzeige inkl. Status).
- `POST /api/einsaetze/{id}/fahrzeuge` — disponieren. Body entweder `{ fahrzeug_id }` (Stamm; `snap_*` aus dem Stamm gefüllt, Dublette → `Conflict`) **oder** `{ adhoc: { funkrufname, fahrzeugtyp?, kennzeichen?, opta?, traegerorganisation? } }` (Ad-hoc; `fahrzeug_id = NULL`). Initial-Status = erster `gebunden`-Status. **Schreibt ETB-Eintrag.**
- `PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id}` — Status ändern und/oder Bemerkung. **Status-Wechsel schreibt ETB-Eintrag.**
- `DELETE /api/einsaetze/{id}/fahrzeuge/{ef_id}` — aus dem Einsatz entfernen (die Dispositionszeile; der Stamm bleibt). **Schreibt ETB-Eintrag.**

### ETB-Integration (Entscheidung 4)

Disponieren / Status-Wechsel / Entfernen erzeugen je einen **automatischen ETB-Eintrag** über den bestehenden `etb::repo::anlegen` mit **`typ = TYP_SYSTEM`** (`src/etb/mod.rs`). Dieser Eintragstyp ist bereits im ETB-Schema vorgesehen (`0004_etb.sql`, CHECK `typ IN (… 'system' …)`) und genau für „automatisch durch spätere Module" reserviert (nicht client-erfassbar) — **keine ETB-Migration nötig**. Der Eintrag wird auf den handelnden Benutzer attribuiert (`erfasser_id`), `ereigniszeit = jetzt`, `lfd_nr` server-autoritativ wie gehabt; Inhalt mit Fahrzeug-Identität, z. B. „Fahrzeug *Florian Musterstadt 83/1* disponiert" / „Status *anfahrt* → *vor Ort*".

## Frontend

### `pages/StammdatenPage.tsx` (erweitern)

Die Seite trägt bereits den Stichwort-Katalog. **Struktur-Entscheidung jetzt (für alle K&M-Specs bindend):** Die Seite wächst mit jeder K&M-Spec (Stichworte, Fahrzeuge, Status, später Personal/Einheiten/Material). Daher ein **Tab-Layout** (antd `Tabs`) statt aneinandergereihter Abschnitte — K&M‑2+ ergänzen dann nur je einen Tab, ohne die Struktur neu zu verhandeln. Zwei neue Tabs in dieser Spec:
- **Fahrzeuge** — Tabelle (Funkrufname, Typ, Träger, Kennzeichen, Status in/außer Dienst). „Fahrzeug anlegen" + Zeilen-Bearbeiten (antd `Form`/`Modal`): alle Stammfelder, Stärke als drei `InputNumber` (Gesamt live berechnet angezeigt), Fahrzeugtyp als `AutoComplete` (Vorschläge org-weit). „Außer Dienst / Wieder in Dienst" statt Löschen. **Nur Admin** editierbar; sonst read-only.
- **Fahrzeug-Status** — Liste der Katalog-Einträge (label, Kategorie-Badge, Farbe, FMS-Anker, Sortierung). Anlegen/Bearbeiten/Deaktivieren (Admin). Kategorie als `Select` (drei Werte mit deutschen Labels).

### `pages/FahrzeugePage.tsx` (neu) — Einsatz-Modul `/einsaetze/:id/fahrzeuge`

- In `App.tsx` als echtes Modul-Element für Key `fahrzeuge` registrieren (ersetzt `ModulStub`).
- In `frontend/src/einsatz/modulRegistry.ts` Eintrag `fahrzeuge` von `status: 'geplant'` auf `'fertig'` setzen; **Eintrag `abrollbehaelter` entfernen** (Entscheidung 9).
- Liste der disponierten Fahrzeuge mit Status-Badge (Farbe aus Katalog). Aktionen, sofern `meine_rolle` schreibberechtigt **und** Einsatz aktiv:
  - **„Fahrzeug disponieren"** → `Select`/Suche über den Stamm-Pool (nur `in_dienst`, noch nicht im Einsatz).
  - **„Ad-hoc-Fahrzeug"** → kleines Formular (Funkrufname Pflicht, Rest optional). *Hinweis: die genaue UX dieses Flows wird in der Umsetzung nochmal geschärft (siehe Offene Punkte).*
  - **Status setzen** (Inline-`Select` aus `GET /api/fahrzeug-status`), **Bemerkung**, **Entfernen**.
- Beobachter / abgeschlossener Einsatz: reine Anzeige.

### API-Module

- `api/fahrzeuge.ts`: `listeFahrzeuge(nurImDienst?)`, `legeFahrzeugAn`, `aktualisiereFahrzeug`, `setzeDienststatus`.
- `api/fahrzeugStatus.ts`: `listeFahrzeugStatus`, `legeStatusAn`, `aktualisiereStatus`, `deaktiviereStatus`.
- `api/einsatzFahrzeuge.ts`: `listeEinsatzFahrzeuge(einsatzId)`, `disponiereFahrzeug`, `disponiereAdhoc`, `aktualisiereDisposition`, `entferneDisposition`.

## Tests

### Backend
- **Stamm-Gating:** `GET` für alle; `POST`/`PATCH`/`ausser-dienst` nur Admin (sonst `Forbidden`).
- **Funkrufname-Eindeutigkeit:** Dublette je Org → `Conflict`; verschiedene Orgs unabhängig.
- **Stärke-Validierung:** alle drei oder keiner; negativ → `Validation`; Gesamt korrekt berechnet.
- **Soft-Delete:** `ausser-dienst` setzt Flag; Fahrzeug verschwindet aus `?nur_im_dienst=true`, bleibt referenzierbar; kein DELETE-Endpunkt.
- **Status-Katalog:** `GET` für alle; CRUD nur Admin; `kategorie` außerhalb Enum → `Validation`; `fms_anker` außerhalb 0–9 → `Validation`; Dublette `label` → `Conflict`; Deaktivieren statt Löschen, referenzierte Dispositionen bleiben gültig.
- **Disposition-Gating:** Einsatzleitung ✓, Führungspersonal ✓, Beobachter → `Forbidden`, Nicht-Mitglied → `Forbidden`; auf abgeschlossenem Einsatz → `Conflict` (409).
- **Disposition Stamm vs. Ad-hoc:** Stamm-Dispo füllt `snap_*` aus dem Stamm; dasselbe Fahrzeug doppelt → `Conflict`; Ad-hoc ohne `fahrzeug_id` mit Pflicht-Funkrufname; mehrere Ad-hoc erlaubt.
- **Schnappschuss-Stabilität:** nachträgliche Stamm-Änderung lässt `snap_*` unverändert; Anzeige-Auflösung liefert Live-Daten bei aktivem Einsatz, Snapshot bei außer Dienst / abgeschlossen.
- **ETB-Eintrag:** Disponieren/Status-Wechsel/Entfernen erzeugen je einen ETB-Eintrag (`typ='system'`) mit Fahrzeug-Identität.
- **Org-Isolation:** Nutzer aus Org A kann Fahrzeuge / Status-Katalog / Dispositionen aus Org B weder lesen noch ändern (`GET` liefert nichts Fremdes; `POST`/`PATCH`/`DELETE` auf fremde IDs → `Forbidden`/`NotFound`).

### Frontend
- Stammdaten-Abschnitte: Admin sieht Anlegen/Bearbeiten/Außer-Dienst und Status-CRUD; Nicht-Admin read-only.
- Stärke-Eingabe zeigt Gesamt live; Fahrzeugtyp-AutoComplete erlaubt freie Eingabe.
- `FahrzeugePage`: Disponieren aus Pool, Ad-hoc anlegen, Status setzen, Entfernen — nur bei Schreibrecht **und** aktivem Einsatz; Beobachter/abgeschlossen reine Anzeige.
- Status-Badge nutzt Katalog-Farbe; Auswahl listet nur aktive Stati.
- **Registry/Regression:** `fahrzeuge` rendert die echte Seite statt Stub; `abrollbehaelter` ist aus Rail/Panel verschwunden; bestehende Einsatz-/ETB-Tests bleiben grün.

## Offene Punkte / Folge-Specs

- **UX des Ad-hoc-Flows** im Einsatz-Modul wird in der Umsetzung geschärft (Quick-Add vs. Dialog, Felder-Reihenfolge).
- **Genaue ETB-Eintragsart** (System-Eintrag) gegen das bestehende ETB-Schema im Plan festlegen.
- **SSE-Live** der Dispositions-Liste über Clients hinweg — Folge.
- **FMS-/Leitstellen-Bridge** (echter Status-Sync via `fms_issi`) — eigene spätere Spec.
- **Echter Standort-Stamm** statt Freitext; **Funktionsgruppe/Verwendung** und weitere Kür-Felder bei Bedarf.
- **Abrollbehälter** ggf. später wieder aufnehmen.
- Wiederverwendung von `Staerke` und des Dispositions-Patterns in **K&M‑2 Personal**, **K&M‑3 Einheiten**, **K&M‑4 Material**.
