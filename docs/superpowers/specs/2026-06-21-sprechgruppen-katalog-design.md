# LFH-109 — Sprechgruppen-Katalog als Stammdaten (Auswahl statt Freitext)

- **ClickUp:** LFH-109 (`86ca7r1tq`) — Folgestufe aus LFH-86
- **Datum:** 2026-06-21
- **Status:** Design freigegeben

## Kontext & Ziel

In LFH-86 wurden die Sprechgruppen (TMO/DMO) am Einsatzabschnitt bewusst als **Freitext**
umgesetzt (`migrations/0047_einsatzabschnitt_funk.sql`: Spalten `sprechgruppe_tmo`,
`sprechgruppe_dmo`). Der Geist „Auswahl statt Freitext" (Datenqualität) ist für Sprechgruppen
noch nicht erfüllt.

Ziel: Ein org-weiter, admin-pflegbarer **Sprechgruppen-Katalog** als Stammdaten, aus dem am
**Einsatzabschnitt** und an der **Einsatz-Einheit** per **Mehrfachauswahl (Checkboxen, M:N)**
Sprechgruppen zugeordnet werden — ergänzt um die Möglichkeit, **einsatz-lokale** Sprechgruppen
ad-hoc anzulegen (ohne den Org-Katalog zu verschmutzen). Bestehende LFH-86-Freitextwerte werden
verlustfrei migriert.

## Akzeptanzkriterien (aus dem Task)

1. Sprechgruppen sind genau einmal als Stammdaten definiert und modulübergreifend per Auswahl
   nutzbar — keine Doppelpflege, keine Tippfehler-Varianten.
2. Bestehende Freitext-Werte aus LFH-86 bleiben migrierbar/weiter nutzbar.

## Nicht-Ziele (YAGNI)

- Kein CROSS-JOIN-Seed eines Start-Katalogs (anders als `einheit_typ`): Sprechgruppen sind
  region-/org-spezifisch → Katalog startet leer, Admins pflegen.
- Keine „einsatz-lokal → Katalog hochstufen"-Funktion (später möglich, jetzt nicht).
- Kein Trägernetz-Feld (nur optionaler `hinweis`-Freitext).
- Zuordnung an `fahrzeug` o.ä. ist nicht Teil dieses Tasks.

## Entschiedene Designfragen

1. **Alt-Freitextspalten** `einsatzabschnitt.sprechgruppe_tmo`/`_dmo` werden **eingefroren**: aus
   dem Schreibpfad entfernt (`AbschnittDaten`/INSERT/UPDATE/`AbschnittBody`), aber in DB + Anzeige
   als historischer Lesewert behalten (Spalten bleiben, kein SQLite-Rebuild der Nicht-Leaf-Tabelle).
   Die Daten wandern per Migration ins Join-Modell. Grep-verifiziert: außer dem einsatzabschnitt-
   Modul/-Route + der Abschnitt-Form liest **nichts** diese Spalten (sonst nur Test-Fixtures), daher
   ist das Einfrieren ohne Folgeschäden — keine Lage-Popup-/PDF-/ETB-/Dashboard-Leser.
2. **Einsatz-lokales Anlegen** darf **jeder Bearbeiter** (`CurrentUser`); Katalogpflege bleibt
   **Admin** (`AdminUser`).
3. **Einsatz-lokale Sprechgruppen sind im ganzen Einsatz wiederverwendbar** (alle Abschnitte +
   Einheiten), nicht pro Abschnitt isoliert.

## Datenmodell — Migration `0073_sprechgruppe.sql`

### Tabelle `sprechgruppe` (Katalog + einsatz-lokal in einer Tabelle)

```sql
CREATE TABLE sprechgruppe (
    id          INTEGER PRIMARY KEY,
    org_id      INTEGER NOT NULL REFERENCES organisation(id),
    einsatz_id  INTEGER REFERENCES einsatz(id) ON DELETE CASCADE, -- NULL = org-weiter Katalog; gesetzt = einsatz-lokal
    bezeichnung TEXT NOT NULL,
    betriebsart TEXT NOT NULL CHECK (betriebsart IN ('TMO','DMO')),
    hinweis     TEXT,                        -- optional
    aktiv       INTEGER NOT NULL DEFAULT 1,  -- Soft-Delete; nur für Katalog relevant
    sortier     INTEGER NOT NULL DEFAULT 0,
    angelegt_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AC#1: Katalog je Org eindeutig (Betriebsart + Bezeichnung), nur aktive:
CREATE UNIQUE INDEX idx_sprechgruppe_katalog
    ON sprechgruppe(org_id, betriebsart, bezeichnung)
    WHERE einsatz_id IS NULL AND aktiv = 1;

-- Einsatz-lokal eindeutig (Wiederverwendung im Einsatz; macht Migration/Inserts idempotent):
CREATE UNIQUE INDEX idx_sprechgruppe_einsatz_lokal
    ON sprechgruppe(einsatz_id, betriebsart, bezeichnung)
    WHERE einsatz_id IS NOT NULL;

CREATE INDEX idx_sprechgruppe_org    ON sprechgruppe(org_id);
CREATE INDEX idx_sprechgruppe_einsatz ON sprechgruppe(einsatz_id);
```

### M:N-Join-Tabellen

```sql
CREATE TABLE einsatzabschnitt_sprechgruppe (
    abschnitt_id    INTEGER NOT NULL REFERENCES einsatzabschnitt(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id)     ON DELETE CASCADE,
    PRIMARY KEY (abschnitt_id, sprechgruppe_id)
);
CREATE TABLE einsatz_einheit_sprechgruppe (
    einheit_id      INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id)    ON DELETE CASCADE,
    PRIMARY KEY (einheit_id, sprechgruppe_id)
);
```

### Daten-Migration der LFH-86-Freitextwerte

Reines SQL, pro Quellspalte (TMO/DMO). Schritt 1 erzeugt je distinct Wert **eine** einsatz-lokale
Sprechgruppe (Wiederverwendung im Einsatz dank Unique-Index); Schritt 2 verknüpft die Abschnitte
über den Wert. `org_id` kommt aus `einsatz`.

```sql
-- TMO: einsatz-lokale Einträge anlegen (distinct je Einsatz)
INSERT OR IGNORE INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart)
SELECT DISTINCT e.org_id, ea.einsatz_id, trim(ea.sprechgruppe_tmo), 'TMO'
FROM einsatzabschnitt ea JOIN einsatz e ON e.id = ea.einsatz_id
WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> '';

-- TMO: Join-Zeilen je Abschnitt
INSERT OR IGNORE INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id)
SELECT ea.id, sg.id
FROM einsatzabschnitt ea
JOIN sprechgruppe sg
  ON sg.einsatz_id = ea.einsatz_id AND sg.betriebsart = 'TMO'
 AND sg.bezeichnung = trim(ea.sprechgruppe_tmo)
WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> '';

-- analog für DMO (sprechgruppe_dmo, Betriebsart 'DMO')
```

Die Alt-Spalten bleiben unangetastet (read-only Reserve). `kommunikationsmittel`/`erreichbarkeit`
(ebenfalls aus 0047) bleiben unverändert.

## Backend (Rust / axum / sqlx-sqlite)

Muster: analog `src/fahrzeug/` (mod + repo) und `src/routes/fahrzeug.rs`. Org-Scoping in **jeder**
Query (`WHERE org_id = ?`), `NotFound` statt `Forbidden` bei fremder Org (keine Org-Enumeration).

- **`src/sprechgruppe/mod.rs`** — Domain `Sprechgruppe` + `SprechgruppeAnzeige` (serialisiert).
  `betriebsart` als String mit CHECK in der DB und String-Konstanten in `src/katalog.rs`
  (`BETRIEBSART_TMO = "TMO"`, `BETRIEBSART_DMO = "DMO"` — exakt das `DIENSTSTATUS_*`-Muster).
  `einsatz_lokal: bool` in der Anzeige (abgeleitet aus `einsatz_id IS NOT NULL`), damit das
  Frontend Katalog vs. ad-hoc unterscheidet.
- **`src/sprechgruppe/repo.rs`**
  - `liste_katalog(pool, org_id, nur_aktive)` — org-weiter Katalog.
  - `liste_fuer_einsatz(pool, org_id, einsatz_id)` — aktiver Katalog **+** einsatz-lokale dieses
    Einsatzes (das ist die Auswahlmenge des Pickers).
  - `anlegen_katalog`, `aktualisiere_katalog`, `deaktiviere` (Soft-Delete `aktiv=0`).
  - `anlegen_einsatz_lokal(pool, org_id, einsatz_id, …)` — idempotent gegen Unique-Index
    (vorhandene zurückgeben statt Fehler).
  - `setze_abschnitt_sprechgruppen(tx, org_id, abschnitt_id, ids)` /
    `setze_einheit_sprechgruppen(tx, org_id, einheit_id, ids)` — Join **ersetzen** (delete+insert
    in einer Transaktion). Validierung: jede id gehört zu dieser Org und ist entweder
    Org-Katalog (`einsatz_id IS NULL`) oder einsatz-lokal des passenden Einsatzes → sonst 422.
  - `lade_abschnitt_sprechgruppen` / `lade_einheit_sprechgruppen` — für die Anzeige.
- **`src/routes/sprechgruppe.rs`** (+ `pub mod sprechgruppe;` in `src/routes/mod.rs`, Routen in
  `src/app.rs`)
  - `GET  /api/sprechgruppen` (Katalog, `CurrentUser`; Query `nur_aktive`)
  - `POST /api/sprechgruppen` (`AdminUser`)
  - `PATCH /api/sprechgruppen/{id}` (`AdminUser`)
  - `POST /api/sprechgruppen/{id}/deaktivieren` (`AdminUser`)
  - `GET  /api/einsaetze/{einsatz_id}/sprechgruppen` (`CurrentUser`; Katalog aktiv + einsatz-lokal)
  - `POST /api/einsaetze/{einsatz_id}/sprechgruppen` (`CurrentUser`; legt einsatz-lokal an)
- **Zuordnung** in bestehenden Routen erweitern:
  - `src/routes/einsatzabschnitt.rs`: `AbschnittBody` um `sprechgruppe_ids: Option<Vec<i64>>`;
    bei `anlegen`/`aktualisieren` Join setzen. `EinsatzabschnittAnzeige` um
    `sprechgruppen: Vec<SprechgruppeAnzeige>`.
  - `src/routes/einsatz_einheit.rs` (Routen unter `/api/einsaetze/{id}/einheiten`; POST=`bilden`,
    PATCH=`aktualisieren`): Body um `sprechgruppe_ids: Option<Vec<i64>>`, Anzeige um
    `sprechgruppen: Vec<SprechgruppeAnzeige>`.

## Frontend (React / antd / TanStack Query)

### Stammdaten-Katalog (Org-weit)
- `frontend/src/api/sprechgruppen.ts` — `listeSprechgruppen()`, `legeSprechgruppeAn()`,
  `aktualisiereSprechgruppe()`, `deaktiviereSprechgruppe()` (Muster `api/fahrzeuge.ts`).
- Typen in `frontend/src/api/types.ts`: `Sprechgruppe`, `SprechgruppeEingabe`, `Betriebsart`.
- `frontend/src/stammdaten/SprechgruppenTab.tsx` (Tabelle: Bezeichnung, Betriebsart-Tag,
  Hinweis, Aktiv; Anlegen/Bearbeiten/Deaktivieren) + `SprechgruppeFormModal.tsx`
  (Felder: Bezeichnung, Betriebsart-Select TMO/DMO, Hinweis). Muster `FahrzeugeTab.tsx` /
  `FahrzeugFormModal.tsx`.
- Neuen Tab in `frontend/src/pages/StammdatenPage.tsx` registrieren.

### Picker-Komponente (wiederverwendbar)
- `frontend/src/components/SprechgruppenPicker.tsx`: lädt
  `GET /api/einsaetze/{id}/sprechgruppen`, rendert **Checkbox-Gruppen nach Betriebsart**
  (Block „TMO", Block „DMO"). Button „+ neue Sprechgruppe" → kleines Inline-Formular
  (Bezeichnung + Betriebsart [+ Hinweis]) → `POST .../sprechgruppen` (einsatz-lokal) → nach
  Erfolg sofort angehakt. Wert nach außen: `number[]` (sprechgruppe_ids). Einsatz-lokale Einträge
  visuell markiert (Badge „lokal").
- Einbau in `EinsatzabschnittePage.tsx`: die beiden `<Input>` (sprechgruppe_tmo/dmo) entfernen,
  `SprechgruppenPicker` einsetzen (`name="sprechgruppe_ids"`).
- Einbau in die Einheit-Form `frontend/src/pages/EinheitenPage.tsx` (API `frontend/src/api/einheiten.ts`):
  `SprechgruppenPicker` ergänzen.

### Anzeige
- Zugeordnete Sprechgruppen als antd-`Tag`s, nach Betriebsart gruppiert, an Abschnitt und Einheit.
  (Tag-Test über Inhalt holen, nicht über Farbklasse — vgl. Projekt-Konvention.)

## Lebenszyklus & Edge Cases

- Einsatz-lokale Sprechgruppen werden mit dem Einsatz gelöscht (`ON DELETE CASCADE` über
  `einsatz_id`). Join-Zeilen cascaden über beide FKs.
- Katalog: nie Hard-Delete; `aktiv=0` deaktiviert. Deaktivierte bleiben aus alten Einsätzen
  auflösbar, erscheinen aber nicht mehr in neuen Auswahllisten. Bestehende Joins bleiben.
- Org-Isolation: Auswahl-/Schreib-Validierung lehnt fremde `sprechgruppe_id` ab (422), Reads sind
  org-scoped (vgl. Cross-Org-Lesezugriff-Hinweis).
- DSGVO: Sprechgruppen-Bezeichnungen sind technisch (keine PII), einsatz-lokale verschwinden per
  Cascade mit dem Einsatz; eigene `schwaerze_einsatz`-Erweiterung nicht nötig — aber im Review
  gegenchecken.

## Tests (TDD-Reihenfolge)

**Backend (cargo, sqlx-Test-Pool):**
1. `repo`: Katalog anlegen/listen (org-scoped), Unique-Verletzung (gleiche Betriebsart+Bezeichnung)
   → Fehler; Soft-Delete entfernt aus aktiver Liste, lässt Joins auflösbar.
2. `repo`: einsatz-lokal anlegen (idempotent), `liste_fuer_einsatz` = aktiver Katalog + lokal.
3. `repo`: `setze_*_sprechgruppen` ersetzt Join; fremde/inaktive id → Fehler; cross-org → NotFound.
4. `routes`: Auth (Katalog-Schreiben nur Admin; einsatz-lokal jeder CurrentUser); Zuordnung
   schreiben+lesen; fremde id → 422.
5. Migration: bestehender Abschnitt mit `sprechgruppe_tmo`/`_dmo` → einsatz-lokale Einträge +
   Join-Zeilen; zwei Abschnitte mit gleichem Wert teilen einen Eintrag.

**Frontend (vitest + RTL):**
6. `SprechgruppenTab`: Liste rendert, Anlegen/Bearbeiten/Deaktivieren.
7. `SprechgruppenPicker`: gruppierte Checkboxen, Mehrfachauswahl, Inline-Anlegen hakt sofort an,
   Wert = ids. (antd Select/Checkbox-Testkonventionen beachten.)
8. Abschnitt-/Einheit-Form: Speichern überträgt `sprechgruppe_ids`; Anzeige zeigt Tags.

## Offene Punkte / Risiken

- `EinheitenPage.tsx` ist groß (Form-Ort für den Picker im Plan exakt verorten).
- Volle Vitest-Suite ist unter Last flaky → Gate mit `--no-file-parallelism`.
- rust-embed: `frontend/dist` muss vor dem Backend-Build existieren (Worktree frisch).
