# K&M‑4 — Material-Stamm & Disposition

**Datum:** 2026-05-27
**Status:** Design abgestimmt, bereit für Implementierungsplan
**Teilprojekt:** 2 „Kräfte & Mittel" — Spec 4 von 4. Verwendet das in [K&M‑1](2026-05-26-kraefte-mittel-fahrzeuge-disposition-design.md) etablierte Dispositions-Pattern wieder und weicht nur bei den Material-Spezifika ab.
**Vorgänger:** [K&M‑1 Fahrzeuge](2026-05-26-kraefte-mittel-fahrzeuge-disposition-design.md) (Unterbau: Stamm/Disposition/Status/ETB/Snapshot/Soft-Delete), [K&M‑2 Personal](2026-05-26-kraefte-mittel-personal-disposition-design.md) (Pattern-Adaption für eine zweite Entity), [K&M‑3 Einheiten](2026-05-26-kraefte-mittel-einheiten-abschnitte-design.md) (Mitgliedschafts-Mechanik `einsatz_einheit` + exklusive `einheit_id`-Spalte; **bereits gebaut**, Migrationen `0014`–`0017`). „Material" ist im [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) Kategorie *Kräfte & Mittel*, Status `geplant` (heute `ModulStub`).

## Problem

Die Kategorie „Kräfte & Mittel" hat mit K&M‑1/2/3 Fahrzeuge, Personal und taktische Einheiten bekommen. Material — das Sachmittel der Organisation (Decken, Sandsäcke, Verbandsmaterial, Verpflegung, Stromerzeuger, Atemschutz, Funkgeräte …) — fehlt noch komplett: kein org-weiter Material-Stamm, keine Disposition von Sachmitteln in den Einsatz, keine Zuordnung von Material zu taktischen Einheiten (in der [Einheiten-Spec](2026-05-26-kraefte-mittel-einheiten-abschnitte-design.md) bewusst auf K&M‑4 verschoben).

Diese Spec zieht das K&M‑1-Pattern für Material durch. Drei Dinge sind bei Material strukturell anders als bei Fahrzeugen/Personal und treiben das Design:

1. **Menge statt Einzel-Identität.** Fahrzeug und Person sind je genau ein Stück (1 Zeile = 1 Ding). Material ist überwiegend Schüttgut, das gezählt wird („50 Decken", „200 Sandsäcke") — neben einzeln verfolgten Geräten („1 Stromerzeuger"). Die Menge sitzt auf der **Dispositionszeile**, **ohne** Bestands-/Lagerführung im Stamm (bewusst „Disposition, keine Lagerverwaltung", Prinzip aus K&M‑1).
2. **Kein Status-Katalog.** Material fährt sich nicht selbst; ohne Bestandszähler trägt die Verfügbarkeits-Kategorie (`verfuegbar`/`gebunden`/`nicht_verfuegbar`) kaum App-Logik. Statt eines admin-pflegbaren Katalogs (Fahrzeug/Personal) ein **kleines festes Status-Enum** direkt auf der Dispositionszeile.
3. **Keine taktische Stärke.** Material hat keine `Staerke`; es zählt auch **nicht** in die Einheiten-Stärke ein.

## Abgestimmte Entscheidungen

1. **Mengen-Modell = Menge je Dispositionszeile, kein Bestandszähler.** Der Stamm ist ein Katalog von Material-*Arten/Stücken* ohne gezählten Bestand. Die `menge` (≥ 1) sitzt auf `einsatz_material`. Es gibt **keine** Verfügbarkeitsrechnung („noch X auf Lager"), keine Reservierung, keine Bestandsabbuchung. Treu zum K&M‑1-Prinzip „Disposition, keine Fuhrpark-/Lagerverwaltung".
2. **Kein Hard-Delete im Stamm.** Material wird nie gelöscht, nur auf `dienststatus = ausser_dienst` gesetzt → Referenzen aus (auch abgeschlossenen) Einsätzen bleiben auflösbar. Identisch zu Fahrzeug/Personal.
3. **Identitäts-Schnappschuss** in jeder Dispositionszeile: `snap_bezeichnung` + `snap_kategorie` + `snap_bestandsnummer` + `snap_traegerorganisation` zum Dispo-Zeitpunkt eingefroren. Beantwortet „welches Material war das" auch nach späteren Stamm-Änderungen. Bei **Ad-hoc-externem** Material (`material_id IS NULL`) *sind* diese Felder die eigentlichen Daten.
4. **Kleines festes Status-Enum, kein Katalog.** `status` ∈ `einsatzbereit` (Default) / `im_einsatz` / `defekt` / `verbraucht` / `desinfektion_noetig` als `CHECK`-Constraint direkt auf `einsatz_material`. Keine Status-Tabelle, keine Kategorie-Semantik, kein `fms_anker`. (`desinfektion_noetig` ist für San-/Rettungsmaterial fachlich relevant.)
5. **Mehrfach-Disposition erlaubt — kein `UNIQUE(einsatz_id, material_id)`.** Bewusste Abweichung von Fahrzeug (dort verhindert der Unique-Index dasselbe physische Fahrzeug doppelt). Dieselbe Material-Art darf in einem Einsatz mehrfach als getrennte Position geführt werden — so wird **Mengen-Splitting auf Einheiten** abgebildet („Decke ×30" → Einheit A, „Decke ×20" → Einheit B), ohne komplexe Teil-Mengen-Logik.
6. **Material → Einheit über exklusive `einheit_id`-Spalte** auf `einsatz_material`, exakt wie Personal/Fahrzeug (K&M‑3-Mitgliedschafts-Pattern, `src/einheit/mitglied_repo.rs`). Eine Position gehört zu max. **einer** Einheit (`NULL` = frei). Zu-/Freigabe über dieselben Routen-Konventionen; beim **Auflösen** einer Einheit wird zugeordnetes Material in derselben Transaktion freigegeben. Material zählt **nicht** in die Einheiten-Stärke ein.
7. **ETB als Historie:** Disponieren / Mengen-Änderung / Status-Wechsel / Einheit-Zu-/Freigabe / Entfernen schreiben je einen automatischen **ETB-Eintrag** (`typ = system`, bestehendes Schema, keine Migration nötig) inkl. Material-Identität **und Menge**. Unveränderliche, append-only Spur — macht das ETB selbsttragend für die spätere Retention-Idee.
8. **Begriff = „Material".** Modul-Label „Material", Entity/Modul-Key `material`. Der globale Stamm ist der eigene Materialbestand der Organisation; externe Spontan-Sachmittel laufen — wie Ad-hoc-Fahrzeuge/-Personal — über die Schnappschuss-Felder, nicht über den Stamm.
9. **Keine `mengeneinheit`** (Stk/Liter/Paar …) — bewusst YAGNI; Stückzahl ist der Default-Fall, Sonderfälle gehen über `bezeichnung`/`bemerkung`.
10. **Schreibrechte** (wie K&M‑1/2/3): Material-Stamm → **System-Admin** (globaler Stammdaten-Bereich). Disponieren / Menge / Status / Ad-hoc / Einheit-Zuordnung im Einsatz → **Einsatzleitung + Führungspersonal**; Beobachter nur lesend; **abgeschlossener Einsatz = read-only** (`fordere_aktiv`).

## Scope-Abgrenzung

**Drin:**
- Globaler **Material-Stamm** (CRUD, Soft-Delete) im Stammdaten-Bereich.
- **Disposition** im Einsatz-Modul „Material": Stamm-Material mit Menge zuordnen, Ad-hoc-externes anlegen, Menge/Status/Bemerkung ändern, entfernen — mit Identitäts-Schnappschuss und ETB-Eintrag.
- **Material → Einheit-Zuordnung** (exklusiv) inkl. Freigabe beim Auflösen der Einheit.
- Abgeleitete **Kategorie-Vorschläge** (DISTINCT) für die AutoComplete.

**Draußen (eigene/spätere Specs oder bestehende Funktionen):**
- **Bestands-/Lagerverwaltung, Verfügbarkeitsrechnung, Reservierung, Inventur.**
- **Admin-pflegbarer Status-Katalog** für Material (festes Enum genügt; bei Bedarf später nachrüstbar wie bei Fahrzeug/Personal).
- **Teil-Mengen-Splitting einer einzelnen Position** (stattdessen: mehrere Positionen disponieren).
- **Wartung/Prüffristen** (z. B. nächste Prüfung Atemschutz/Stromerzeuger), Seriennummern-Historie, Beladungs-/Packlisten.
- **SSE-Live-Aktualisierung der Dispositions-Liste** über Clients hinweg — Folge (spiegelt vorerst über Refetch/Invalidierung und die live geschriebenen ETB-Einträge).
- **Daten-Retention abgeschlossener Einsätze** (ETB + PDF-Report) — querschnittliche Folge-Spec.

## Datenmodell

Material braucht — anders als Fahrzeug/Personal — **keine** Status-Katalog-Migration. Daher nur zwei neue Migrationen.

### Migration `0018_material.sql` — Material-Stamm (global, org-weit)

```sql
CREATE TABLE material (
    id                  INTEGER PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung         TEXT NOT NULL,            -- "Wolldecke", "Stromerzeuger 5 kVA"
    kategorie           TEXT,                     -- Combobox; Vorschläge abgeleitet (DISTINCT)
    bestandsnummer      TEXT,                     -- optional, nur für einzeln verfolgte Geräte (Inventarnr.)
    traegerorganisation TEXT,                     -- frei; UI default = Name der eigenen Org
    standort            TEXT,                     -- Freitext (echter Standort-Stamm später)
    bemerkung           TEXT,
    dienststatus        TEXT NOT NULL DEFAULT 'in_dienst'
                        CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bestandsnummer je Organisation eindeutig, aber nur unter aktiven Stücken
-- (außer Dienst gestellte geben die Nummer zur Wiederverwendung frei):
CREATE UNIQUE INDEX idx_material_bestandsnummer
    ON material(org_id, bestandsnummer)
    WHERE bestandsnummer IS NOT NULL AND dienststatus = 'in_dienst';
```

- **Keine Bezeichnungs-Eindeutigkeit.** Anders als der Fahrzeug-Funkrufname ist `bezeichnung` *nicht* eindeutig — mehrere Einträge „Wolldecke" sind erlaubt (analog zum Personal-Namen). Dubletten-Schutz nur über die optionale `bestandsnummer` (partieller Unique-Index, nur unter aktiven Stücken; Dublette → `Conflict` 409).
- **Kein Mengenfeld im Stamm.** Der Stamm beschreibt die Material-*Art/das Stück*, nicht einen Bestand (Entscheidung 1). Die Menge entsteht erst bei der Disposition.
- **Soft-Delete**: kein DELETE; „löschen" = `dienststatus = ausser_dienst`. Außer-Dienst-Material erscheint nicht in der Dispositions-Auswahl, bleibt aber referenzierbar.

### Migration `0019_einsatz_material.sql` — Disposition (pro Einsatz)

```sql
CREATE TABLE einsatz_material (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    material_id     INTEGER REFERENCES material(id),          -- NULL = Ad-hoc extern
    einheit_id      INTEGER REFERENCES einsatz_einheit(id),   -- Mitgliedschaft (exklusiv); NULL = frei
    menge           INTEGER NOT NULL DEFAULT 1 CHECK (menge >= 1),
    status          TEXT NOT NULL DEFAULT 'einsatzbereit'
                    CHECK (status IN ('einsatzbereit', 'im_einsatz', 'defekt', 'verbraucht', 'desinfektion_noetig')),
    -- Identitäts-Schnappschuss (eingefroren beim Disponieren);
    -- bei Ad-hoc-extern sind dies die eigentlichen Daten:
    snap_bezeichnung         TEXT NOT NULL,
    snap_kategorie           TEXT,
    snap_bestandsnummer      TEXT,
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id)
);

CREATE INDEX idx_einsatz_material_einsatz ON einsatz_material(einsatz_id);
```

- **`snap_*`** dient doppelt: Identitäts-Schnappschuss für Stamm-Material **und** Datenträger für Ad-hoc-externes (dort `material_id IS NULL`).
- **Kein `UNIQUE(einsatz_id, material_id)`** (Entscheidung 5): dieselbe Material-Art darf mehrfach als getrennte Position vorkommen.
- **`status`** ist festes Enum auf der Dispositionszeile (Einsatz-Zustand), wird **nicht** aus einem Katalog aufgelöst. Initial beim Disponieren = `einsatzbereit`.
- **`einheit_id`** = exklusive Mitgliedschaft an einer `einsatz_einheit` (Entscheidung 6); `NULL` = freie, nicht zugeordnete Position. Kein `ON DELETE` (wird app-seitig beim Auflösen freigegeben — wie bei Personal/Fahrzeug, vgl. `0017_einheit_mitgliedschaft.sql`).
- **Anzeige-Auflösung**: Bei `material_id` gesetzt **und** Einsatz aktiv **und** Material `in_dienst` → Live-Felder aus `material` (Korrekturen sofort sichtbar). Sonst (Ad-hoc, Stamm außer Dienst, abgeschlossener Einsatz) → `snap_*`. `menge` und `status` kommen **immer** aus der Dispositionszeile.

### Typen (`src/material/mod.rs`, neu)

- `Material` (`sqlx::FromRow`), `MaterialAnzeige` (`Serialize`).
- `MaterialStatus`-Enum (`einsatzbereit`/`im_einsatz`/`defekt`/`verbraucht`/`desinfektion_noetig`) mit `as_str`/`parse` (analog `StaerkePosition` in `src/staerke.rs`).
- `EinsatzMaterialAnzeige` (`Serialize`): aufgelöste Sicht inkl. `menge`, `status`, `einheit_id` und der nach obiger Regel gewählten Identität.
- **Kein** `Staerke`-Bezug.

### Frontend-Typen (`frontend/src/api/types.ts`)

`Material`, `MaterialStatus = 'einsatzbereit' | 'im_einsatz' | 'defekt' | 'verbraucht' | 'desinfektion_noetig'`, `EinsatzMaterial` (inkl. `menge`, `status`, `einheit_id`). `Dienststatus` wird wiederverwendet.

## Backend

Neues Domänen-Modul `src/material/` (`mod.rs`, `repo.rs`, `disposition_repo.rs`) analog `src/fahrzeug/`. Neue Routen-Module + Registrierung in `src/routes/mod.rs` und `src/app.rs`.

### Globaler Material-Stamm — `src/routes/material.rs`

- `GET /api/material` — alle eingeloggten Nutzer (Lesen), eigene Organisation, sortiert nach `bezeichnung`; Query-Param `?nur_im_dienst=true` für die Dispositions-Auswahl.
- `GET /api/material-kategorien` — abgeleitete Kategorie-Vorschläge für die AutoComplete (`SELECT DISTINCT kategorie … WHERE org_id = ? AND kategorie IS NOT NULL`), eigene Org. Kein eigener Katalog/keine eigene Tabelle.
- `POST /api/material` — **Admin** (`AdminUser`). Validierung: `bezeichnung` getrimmt nicht leer; Bestandsnummer-Dublette (unter aktiven) → `Conflict`.
- `PATCH /api/material/{id}` — **Admin**. Vollersatz der editierbaren Felder (Lese-/Bearbeiten-Workflow wie Fahrzeug/Personal). Bestandsnummer-Dublette → `Conflict`.
- `POST /api/material/{id}/ausser-dienst` und `.../in-dienst` — **Admin**. Setzt `dienststatus` (Soft-Delete). Kein DELETE.

### Disposition im Einsatz — `src/routes/einsatz_material.rs`

Gate für alle schreibenden Routen: `fordere_schreibrecht(meine_rolle)` (Einsatzleitung/Führungspersonal) **und** `fordere_aktiv(einsatz)`. Lesen: `fordere_lesezugriff`.

- `GET /api/einsaetze/{id}/material` — disponierte Positionen des Einsatzes (aufgelöste Anzeige inkl. `menge`, `status`, `einheit_id`).
- `POST /api/einsaetze/{id}/material` — disponieren. Body entweder `{ material_id, menge }` (Stamm; `snap_*` aus dem Stamm gefüllt) **oder** `{ adhoc: { bezeichnung, kategorie?, bestandsnummer?, traegerorganisation? }, menge }` (Ad-hoc; `material_id = NULL`). `menge` ≥ 1 (Default 1), `status = einsatzbereit`. **Schreibt ETB-Eintrag** (inkl. Menge).
- `PATCH /api/einsaetze/{id}/material/{em_id}` — `menge` und/oder `status` und/oder `bemerkung`. **Mengen-Änderung und Status-Wechsel schreiben je einen ETB-Eintrag.**
- `DELETE /api/einsaetze/{id}/material/{em_id}` — aus dem Einsatz entfernen (die Dispositionszeile; der Stamm bleibt). **Schreibt ETB-Eintrag.**

### Material → Einheit — Erweiterung von `src/einheit/mitglied_repo.rs` + `src/routes/einsatz_einheit.rs`

Exakt das bestehende Muster (vgl. `ordne_personal_zu`/`gib_personal_frei`, `ordne_fahrzeug_zu`/`gib_fahrzeug_frei`):

- `PUT /api/einsaetze/{id}/einheiten/{eid}/material/{em_id}` — Material einer Einheit zuordnen (exklusiv; setzt `einsatz_material.einheit_id`). **ETB-Eintrag** („Einheit «…»: Material «…» zugeordnet").
- `DELETE /api/einsaetze/{id}/einheiten/{eid}/material/{em_id}` — freigeben (`einheit_id = NULL`). **ETB-Eintrag**.
- Neue Repo-Funktionen `mitglied_repo::ordne_material_zu` / `gib_material_frei` (analog zu Fahrzeug, ohne Führer-Sonderlogik — Material kann kein Führer sein).
- `EinheitAnzeige` (`src/einheit/`) bekommt eine **Material-Mitglieder-Liste** (neue `MaterialRow` in `mitglied_repo`, mit `em_id`, `bezeichnung`, `menge`, `status`).
- **Auflösen der Einheit** (`einheit_repo::loese_auf`): die bestehende Freigabe-Transaktion (Personal/Fahrzeug `einheit_id = NULL`) wird um `einsatz_material` erweitert.

### ETB-Integration (Entscheidung 7)

Disponieren / Mengen-Änderung / Status-Wechsel / Einheit-Zu-/Freigabe / Entfernen erzeugen je einen **automatischen ETB-Eintrag** über den bestehenden `etb::repo::anlegen` mit **`typ = TYP_SYSTEM`** (`src/etb/mod.rs`; im Schema `0004_etb.sql` bereits vorgesehen) — **keine ETB-Migration nötig**. Attribuiert auf den handelnden Benutzer (`erfasser_id`), `ereigniszeit = jetzt`, `lfd_nr` server-autoritativ. Inhalt mit Material-Identität **und Menge**, z. B. „Material *Wolldecke ×50* disponiert" / „*Wolldecke* Menge *50* → *30*" / „*Stromerzeuger* Status *defekt*".

## Frontend

### `pages/StammdatenPage.tsx` (erweitern)

Ein **neuer Tab „Material"** (das Tab-Layout existiert bereits aus K&M‑1):
- Tabelle (Bezeichnung, Kategorie, Bestandsnummer, Träger, in/außer Dienst). „Material anlegen" + Zeilen-Bearbeiten (antd `Form`/`Modal`): alle Stammfelder, `kategorie` als `AutoComplete` (Vorschläge org-weit via `GET /api/material-kategorien`). „Außer Dienst / Wieder in Dienst" statt Löschen. **Nur Admin** editierbar; sonst read-only.

### `pages/MaterialPage.tsx` (neu) — Einsatz-Modul `/einsaetze/:id/material`

- In `App.tsx` als echtes Modul-Element für Key `material` registrieren (ersetzt `ModulStub`); in `frontend/src/einsatz/modulRegistry.ts` Eintrag `material` von `status: 'geplant'` auf `'fertig'` setzen.
- Liste der disponierten Positionen mit **Menge** und **Status-Badge** (feste Status-Labels/Farben, da Enum). Aktionen, sofern `meine_rolle` schreibberechtigt **und** Einsatz aktiv:
  - **„Material disponieren"** → `Select`/Suche über den Stamm-Pool (nur `in_dienst`) + **Mengen-Input** (`InputNumber`, min 1).
  - **„Ad-hoc-Material"** → kleines Formular (Bezeichnung Pflicht, Rest optional, Menge).
  - **Menge ändern**, **Status setzen** (Inline-`Select`, feste 5 Werte), **Bemerkung**, **Einheit zuordnen/freigeben**, **Entfernen**.
- Beobachter / abgeschlossener Einsatz: reine Anzeige.

### Einheiten-Ansicht (erweitern)

Die bestehende Einheiten-Detailansicht (Personal-/Fahrzeug-Mitglieder) bekommt eine **Material-Mitglieder-Sektion** mit Zuordnen/Freigeben (bei Schreibrecht + aktivem Einsatz).

### API-Module

- `api/material.ts`: `listeMaterial(nurImDienst?)`, `legeMaterialAn`, `aktualisiereMaterial`, `setzeDienststatus`, `listeKategorien`.
- `api/einsatzMaterial.ts`: `listeEinsatzMaterial(einsatzId)`, `disponiereMaterial`, `disponiereAdhoc`, `aktualisiereDisposition` (menge/status/bemerkung), `entferneDisposition`, `ordneEinheitZu`, `gibEinheitFrei`.

## Tests

### Backend
- **Stamm-Gating:** `GET` für alle; `POST`/`PATCH`/`ausser-dienst` nur Admin (sonst `Forbidden`).
- **Bestandsnummer-Eindeutigkeit:** Dublette je Org (unter aktiven) → `Conflict`; verschiedene Orgs unabhängig; `NULL`-Bestandsnummer beliebig oft.
- **Bezeichnung nicht eindeutig:** zwei „Wolldecke" anlegbar.
- **Soft-Delete:** `ausser-dienst` setzt Flag; Material verschwindet aus `?nur_im_dienst=true`, bleibt referenzierbar; kein DELETE-Endpunkt; Bestandsnummer nach Außer-Dienst wieder vergebbar.
- **Disposition-Gating:** Einsatzleitung ✓, Führungspersonal ✓, Beobachter → `Forbidden`, Nicht-Mitglied → `Forbidden`; auf abgeschlossenem Einsatz → `Conflict` (409).
- **Disposition Stamm vs. Ad-hoc:** Stamm-Dispo füllt `snap_*` aus dem Stamm; **dasselbe Material mehrfach disponierbar** (kein Conflict); Ad-hoc ohne `material_id` mit Pflicht-`bezeichnung`; `menge < 1` → `Validation`.
- **Menge & Status:** `PATCH` ändert `menge`/`status`; ungültiger Status → `Validation`; Mengen-Änderung und Status-Wechsel erzeugen je einen ETB-Eintrag.
- **Schnappschuss-Stabilität:** nachträgliche Stamm-Änderung lässt `snap_*` unverändert; Anzeige-Auflösung liefert Live-Identität bei aktivem Einsatz + `in_dienst`, Snapshot bei außer Dienst / abgeschlossen; `menge`/`status` immer aus der Dispositionszeile.
- **Material → Einheit:** Zuordnen setzt `einheit_id` (exklusiv: erneutes Zuordnen wechselt); Freigeben setzt `NULL`; Auflösen der Einheit gibt zugeordnetes Material frei; Zu-/Freigabe erzeugen ETB-Einträge; fremde `em_id`/`eid` → `NotFound`.
- **ETB-Eintrag:** Disponieren/Menge/Status/Einheit/Entfernen erzeugen je einen ETB-Eintrag (`typ='system'`) mit Material-Identität und Menge.
- **Org-Isolation:** Nutzer aus Org A kann Material / Dispositionen aus Org B weder lesen noch ändern (`GET` liefert nichts Fremdes; `POST`/`PATCH`/`DELETE` auf fremde IDs → `Forbidden`/`NotFound`).

### Frontend
- Stammdaten-Tab: Admin sieht Anlegen/Bearbeiten/Außer-Dienst; Nicht-Admin read-only; Kategorie-AutoComplete erlaubt freie Eingabe.
- `MaterialPage`: Disponieren aus Pool mit Menge, Ad-hoc anlegen, Menge/Status ändern, Einheit zuordnen/freigeben, Entfernen — nur bei Schreibrecht **und** aktivem Einsatz; Beobachter/abgeschlossen reine Anzeige.
- Status-Badge nutzt feste 5 Werte; Mengen-Input erzwingt min 1.
- **Registry/Regression:** `material` rendert die echte Seite statt Stub; bestehende Einsatz-/ETB-/Einheiten-Tests bleiben grün.

## Offene Punkte / Folge-Specs

- **UX des Ad-hoc-/Mengen-Flows** im Einsatz-Modul wird in der Umsetzung geschärft (Quick-Add vs. Dialog, Mengen-Input-Platzierung).
- **SSE-Live** der Dispositions-Liste über Clients hinweg — Folge (gilt für alle K&M-Module).
- **Admin-pflegbarer Material-Status-Katalog** statt festem Enum — bei Bedarf später nachrüstbar (Pattern von Fahrzeug/Personal vorhanden).
- **Wartung/Prüffristen, Beladungs-/Packlisten, echter Standort-Stamm** — bei Bedarf eigene spätere Specs.
- **Daten-Retention abgeschlossener Einsätze** (ETB + PDF-Report) — querschnittliche Folge-Spec.
