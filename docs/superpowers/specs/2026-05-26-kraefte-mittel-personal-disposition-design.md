# K&M‑2 — Personal-Stamm & Disposition

**Datum:** 2026-05-26
**Status:** Design abgestimmt, bereit für Implementierungsplan
**Teilprojekt:** 2 „Kräfte & Mittel" — Spec 2 von 4. Verwendet das in [K&M‑1](2026-05-26-kraefte-mittel-fahrzeuge-disposition-design.md) etablierte Dispositions-Pattern wieder und weicht nur bei den Personal-Spezifika ab.
**Vorgänger:** [K&M‑1 Fahrzeuge](2026-05-26-kraefte-mittel-fahrzeuge-disposition-design.md) — legt Stamm/Disposition/Status-Katalog/ETB-Integration als Unterbau fest. „Personal" ist im [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) Kategorie *Kräfte & Mittel*, Status `geplant` (heute `ModulStub`).

## Problem

Die Kategorie „Kräfte & Mittel" hat mit K&M‑1 ihren ersten echten Stamm (Fahrzeuge) bekommen. Personal — die Einsatzkräfte der Organisation — fehlt noch komplett: kein org-weiter Personenstamm, keine Disposition von Kräften in den Einsatz, kein operativer Personal-Status. Ohne Personal lässt sich später auch K&M‑3 (taktische Einheiten) nicht bauen, weil eine Einheit Führer + Mannschaft bündelt, die vorher existieren müssen.

Diese Spec zieht das K&M‑1-Pattern für Personal durch. Drei Dinge sind bei Personal strukturell anders als bei Fahrzeugen und treiben das Design:

1. **n:m-Qualifikationen** statt 1:n-Status — eine Person ist gleichzeitig z. B. Sanitäter *und* Gruppenführer *und* Maschinist.
2. **Taktische Stärke-Position** (Führer/Unterführer/Mannschaft) ist pro Person *einer* von drei Werten und oft einsatzbezogen — anders als die optionale Soll-Stärke eines Fahrzeugs.
3. **Keine FMS-Anbindung** — der Personal-Status-Katalog übernimmt das Schema von `fahrzeug_status`, aber ohne `fms_anker`.

## Abgestimmte Entscheidungen

1. **Personal = eigene Tabelle mit optionalem Benutzer-Link.** Neue Tabelle `personal` (org-weiter Personenstamm). `personal.benutzer_id` ist ein **optionaler** Verweis auf ein App-Konto (`benutzer`). In der BOS-Realität hat die Mehrheit der Einsatzkräfte kein Login → Personal-Datensätze existieren unabhängig von Konten. Höchstens ein Personal-Datensatz je Benutzerkonto.
2. **Qualifikationen = admin-pflegbarer Katalog + echte n:m-Zuordnung.** Tabelle `qualifikation` (org-weiter Katalog, analog zum Status-Katalog: deaktivierbar statt löschbar) + Join-Tabelle `personal_qualifikation`. Auswertbar/filterbar; bewusste Abweichung vom 1:n-Status-Pattern aus K&M‑1.
3. **Stärke-Position = Stamm-Default + Dispo-Override.** Person trägt eine optionale Standard-Position (`fuehrer`/`unterfuehrer`/`mannschaft`) im Stamm; beim Disponieren überschreibbar. Eine Person zählt genau 1 in genau einem der drei Töpfe. Die Summe der Dispositionszeilen liefert später (K&M‑3) die Einheiten-Stärke.
4. **Eigener Personal-Status-Katalog**, gleiches Schema/Pattern wie `fahrzeug_status` (`label`, feste Semantik-`kategorie` ∈ `verfuegbar`/`gebunden`/`nicht_verfuegbar`, optionale `farbe`, `sortier`, `aktiv`), aber **ohne `fms_anker`**. Eigene Seed-Default-Liste. Vom Admin umbenenn-/erweiter-/sortierbar; nicht hart löschbar (deaktivieren).
5. **Ad-hoc-externe Personen disponierbar** (Pattern-Parität zu K&M‑1): Dispositionszeile mit `personal_id = NULL`; die `snap_*`-Felder *sind* dann die eigentlichen Daten (z. B. spontaner Notarzt, Mutual-Aid-Kraft).
6. **Identitäts-Schnappschuss** in jeder Dispositionszeile: `snap_name`, `snap_funktion` (Qualifikationen/Funktion als flacher Text, eingefroren), `snap_traegerorganisation`. Beantwortet „wer war das" auch nach späteren Stamm-Änderungen. Qualifikationen werden bewusst **als Text** eingefroren, nicht als Join-Kopie (Snapshot dient Anzeige/Nachweis, wird nicht abgefragt).
7. **ETB als Historie:** Disponieren / Status-Wechsel / Entfernen schreiben je einen automatischen **ETB-Eintrag** (`typ = system`, bestehendes Schema, keine Migration nötig) inkl. Personen-Identität. Unveränderliche, append-only Spur — macht das ETB selbsttragend für die spätere Retention-Idee.
8. **Begriff = „Personal".** Modul-Label „Personal", Entity/Modul-Key `personal`. Der globale Stamm ist der eigene Personenstamm der Organisation; externe Spontankräfte laufen — wie Ad-hoc-Fahrzeuge — über die Schnappschuss-Felder, nicht über den Stamm.
9. **PII = wie K&M‑1, kein Sonderschutz in K&M‑2.** Personal-Stamm lesbar für alle eingeloggten Nutzer der eigenen Org (Dropdowns/Dispo-Auswahl); Schreiben = Admin; Disposition = Rollen-Gate. Kontaktdaten minimal (nur `telefon`). Verschärfte PII-/Datenschutz-Rechte sind ein eigenes Backlog-Thema.
10. **Schreibrechte** (wie K&M‑1): Personal-Stamm + Qualifikations-Katalog + Status-Katalog → **System-Admin** (globaler Stammdaten-Bereich). Disponieren/Status-Setzen/Ad-hoc im Einsatz → **Einsatzleitung + Führungspersonal**; Beobachter nur lesend; **abgeschlossener Einsatz = read-only** (`fordere_aktiv`).

## Scope-Abgrenzung

**Drin:**
- Globaler **Personal-Stamm** (CRUD, Soft-Delete) im Stammdaten-Bereich, mit optionalem Benutzer-Link.
- Org-weiter **Qualifikations-Katalog** (CRUD, Deaktivieren) + n:m-Zuordnung Person ↔ Qualifikationen.
- Org-weiter **Personal-Status-Katalog** (CRUD, Deaktivieren).
- **Disposition** im Einsatz-Modul „Personal": Stamm-Personen zuordnen, Ad-hoc-externe anlegen, Status setzen, Stärke-Position wählen, entfernen — mit Identitäts-Schnappschuss und ETB-Eintrag.
- Erweiterung des wiederverwendbaren `Staerke`-Typs um `StaerkePosition` + Aggregation (K&M‑3-Vorbereitung).

**Draußen (eigene/spätere Specs):**
- **Taktische Einheiten / Zuordnung zu Einsatzabschnitten** — K&M‑3 (komponiert Personal + Fahrzeuge).
- **Skill-/Qualifikations-Matrix-Auswertung** über einfache Filterung hinaus (z. B. „wer ist Notarzt UND verfügbar").
- **Anwesenheits-/Stundenerfassung, Dienstplan, Qualifikations-Ablaufdaten/Ausbildungsstand-Tracking.**
- **Verschärfte PII-/Datenschutz-Leserechte** — Backlog.
- **SSE-Live-Aktualisierung der Dispositions-Liste** über Clients hinweg — Folge (spiegelt vorerst über Refetch/Invalidierung und die live geschriebenen ETB-Einträge).
- **Kopplung Personal-Disposition ↔ `einsatz_mitglied`:** bleibt **orthogonal**. Ein disponiertes Personal mit `benutzer_id`-Link wird *nicht* automatisch Einsatz-Mitglied (mit Einsatzrolle); das sind getrennte Konzepte (Disposition = operative Kraft im Einsatz, Mitgliedschaft = App-Zugriff/Rolle).

## Datenmodell

### Migration `0010_personal.sql` — Personal-Stamm (global, org-weit)

```sql
CREATE TABLE personal (
    id                  INTEGER PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES organisation(id),
    benutzer_id         INTEGER REFERENCES benutzer(id),  -- optionaler Link zum App-Konto
    name                TEXT NOT NULL,                    -- Klarname/Anzeigename (NICHT eindeutig)
    personalnummer      TEXT,                             -- optional, org-intern
    traegerorganisation TEXT,                             -- frei; UI default = Name der eigenen Org
    telefon             TEXT,                             -- optional, minimale Kontakt-PII
    staerke_position    TEXT                              -- Stamm-Default-Position, optional
                        CHECK (staerke_position IN ('fuehrer', 'unterfuehrer', 'mannschaft')),
    bemerkung           TEXT,
    dienststatus        TEXT NOT NULL DEFAULT 'in_dienst'
                        CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personalnummer je Organisation eindeutig, aber nur unter aktiven Personen
-- (außer Dienst gestellte geben die Nummer zur Wiederverwendung frei):
CREATE UNIQUE INDEX idx_personal_personalnummer
    ON personal(org_id, personalnummer)
    WHERE personalnummer IS NOT NULL AND dienststatus = 'in_dienst';

-- Höchstens ein Personal-Datensatz je verknüpftem Benutzerkonto:
CREATE UNIQUE INDEX idx_personal_benutzer
    ON personal(benutzer_id) WHERE benutzer_id IS NOT NULL;
```

- **Kein Funkrufname-Äquivalent / keine Namens-Eindeutigkeit.** Anders als Fahrzeuge haben Personen keinen eindeutigen Bezeichner — zwei „Thomas Müller" sind erlaubt. Dubletten-Schutz nur über die optionale `personalnummer` (partieller Unique-Index, nur unter aktiven Personen; Dublette → `Conflict` 409).
- **`benutzer_id`** optional und eindeutig (ein Konto ↔ höchstens eine Person). Beim Setzen auf ein bereits verknüpftes Konto → `Conflict`.
- **`staerke_position`** ist genau einer von drei Werten oder `NULL` (Person ohne festgelegte Standard-Position).
- **Soft-Delete**: kein DELETE; „löschen" = `dienststatus = ausser_dienst`. Außer-Dienst-Personen erscheinen nicht in der Dispositions-Auswahl, bleiben aber referenzierbar.

### Migration `0011_qualifikation.sql` — Qualifikations-Katalog (org-weit) + n:m-Join

```sql
CREATE TABLE qualifikation (
    id      INTEGER PRIMARY KEY,
    org_id  INTEGER NOT NULL REFERENCES organisation(id),
    label   TEXT NOT NULL,
    sortier INTEGER NOT NULL DEFAULT 0,
    aktiv   INTEGER NOT NULL DEFAULT 1,  -- Soft-Delete (deaktivieren statt löschen)
    UNIQUE(org_id, label)
);

CREATE TABLE personal_qualifikation (
    personal_id      INTEGER NOT NULL REFERENCES personal(id),
    qualifikation_id INTEGER NOT NULL REFERENCES qualifikation(id),
    PRIMARY KEY (personal_id, qualifikation_id)
);
```

**Seed-Default je Organisation** (modest; Admin erweitert org-spezifisch; analog zur Status-Seedung im Admin-Bootstrap, plus Seed der bestehenden Org in der Migration):

| label | sortier |
|---|---|
| Sanitäter | 10 |
| Rettungssanitäter | 20 |
| Notfallsanitäter | 30 |
| Notarzt | 40 |
| Truppführer | 50 |
| Gruppenführer | 60 |
| Zugführer | 70 |
| Maschinist | 80 |
| Sprechfunker | 90 |

- **Deaktivieren statt Löschen**: eine deaktivierte Qualifikation bleibt für bestehende `personal_qualifikation`-Zuordnungen gültig, erscheint aber nicht mehr in der Auswahl beim Bearbeiten.

### Migration `0012_personal_status.sql` — Status-Katalog (org-weit, admin-pflegbar)

```sql
CREATE TABLE personal_status (
    id        INTEGER PRIMARY KEY,
    org_id    INTEGER NOT NULL REFERENCES organisation(id),
    label     TEXT NOT NULL,
    kategorie TEXT NOT NULL
              CHECK (kategorie IN ('verfuegbar', 'gebunden', 'nicht_verfuegbar')),
    farbe     TEXT,                        -- optional, Hex (#rrggbb) für Lageübersicht
    sortier   INTEGER NOT NULL DEFAULT 0,
    aktiv     INTEGER NOT NULL DEFAULT 1,  -- Soft-Delete (deaktivieren statt löschen)
    UNIQUE(org_id, label)
);
```

**Seed-Default je Organisation** (gespiegelt im Admin-Bootstrap + bestehende Org in der Migration):

| label | kategorie | sortier |
|---|---|---|
| verfügbar | `verfuegbar` | 10 |
| alarmiert | `gebunden` | 20 |
| auf Anfahrt | `gebunden` | 30 |
| im Einsatz | `gebunden` | 40 |
| Pause | `nicht_verfuegbar` | 50 |
| abgemeldet | `nicht_verfuegbar` | 60 |

Schema bewusst identisch zu `fahrzeug_status` **minus `fms_anker`** — die Repo-/Routen-Logik ist nahezu deckungsgleich und kann sich an `fahrzeug_status` orientieren. Die **Kategorie** bleibt das, woran der Code Verfügbarkeit erkennt.

### Migration `0013_einsatz_personal.sql` — Disposition (pro Einsatz)

```sql
CREATE TABLE einsatz_personal (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id),
    personal_id     INTEGER REFERENCES personal(id),         -- NULL = Ad-hoc extern
    status_id       INTEGER REFERENCES personal_status(id),  -- aktueller Einsatz-Status
    staerke_position TEXT                                    -- Dispo-Override (sonst Stamm-Default)
                    CHECK (staerke_position IN ('fuehrer', 'unterfuehrer', 'mannschaft')),
    -- Identitäts-Schnappschuss (eingefroren beim Disponieren);
    -- bei Ad-hoc-extern sind dies die eigentlichen Daten:
    snap_name                TEXT NOT NULL,
    snap_funktion            TEXT,    -- Qualifikationen/Funktion als flacher Text, z. B. "Gruppenführer, Sanitäter"
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id),
    UNIQUE(einsatz_id, personal_id)   -- eine Stamm-Person je Einsatz nur einmal; mehrere NULL erlaubt
);
```

- **`snap_*`** dient doppelt: Identitäts-Schnappschuss für Stamm-Personen **und** Datenträger für Ad-hoc-externe (dort `personal_id IS NULL`).
- **`snap_funktion`**: beim Disponieren aus den aktiven Qualifikationen der Person zu einem Text zusammengesetzt (nach `qualifikation.sortier`, kommasepariert); bei Ad-hoc Freitext-Eingabe.
- **`UNIQUE(einsatz_id, personal_id)`**: dieselbe Stamm-Person nicht doppelt im selben Einsatz; mehrere `NULL` (Ad-hoc) erlaubt.
- **Status beim Disponieren**: `status_id` auf den ersten aktiven Status der Kategorie `gebunden` gesetzt — **deterministisch nach `sortier`, dann `id`** (i. d. R. „alarmiert"); fehlt ein solcher, bleibt `NULL` und wird in der UI gewählt.
- **Stärke-Position-Auflösung**: `einsatz_personal.staerke_position` falls gesetzt, sonst Fallback auf `personal.staerke_position` (live, bei Stamm-Person). Bei Ad-hoc nur das Dispo-Feld.
- **Anzeige-Auflösung** (wie K&M‑1): `personal_id` gesetzt **und** Einsatz aktiv → Live-Felder aus `personal` + Live-Qualifikationen aus dem Join (Korrekturen sofort sichtbar). Sonst (Ad-hoc, Stamm außer Dienst, abgeschlossener Einsatz) → `snap_*`.

### Typen (`src/personal/mod.rs`, neu)

- `Personal` (`sqlx::FromRow`), `PersonalAnzeige` (`Serialize`) — Letzteres inkl. aufgelöster Qualifikations-Labels und `staerke_position`.
- `Qualifikation` (Katalog-Eintrag, `Serialize`/`FromRow`).
- `PersonalStatus` (Katalog-Eintrag), Wiederverwendung der Kategorie-Konstanten/Validierung aus `fahrzeug` (`KATEGORIE_*`, `ist_gueltige_kategorie`) — gemeinsam genutzt, ggf. nach `src/staerke.rs` o. ä. gezogen, im Plan zu entscheiden.
- `EinsatzPersonalAnzeige` (`Serialize`): aufgelöste Sicht inkl. Status (label/kategorie/farbe), gewählter Identität und aufgelöster Stärke-Position.

### Stärke-Erweiterung (`src/staerke.rs`)

- Neuer Enum `StaerkePosition { Fuehrer, Unterfuehrer, Mannschaft }` mit `parse(&str) -> Option<Self>` und `as_str()` (DB-Roundtrip).
- Aggregations-Helfer `Staerke::aus_positionen(impl Iterator<Item = StaerkePosition>) -> Staerke` (zählt je Topf). Damit summiert K&M‑3 die Einheiten-Stärke direkt aus den Dispositionszeilen, ohne neue Logik.

### Frontend-Typen (`frontend/src/api/types.ts`)

`Personal`, `Qualifikation`, `PersonalStatus`, `StaerkePosition = 'fuehrer' | 'unterfuehrer' | 'mannschaft'`, `EinsatzPersonal`. `StatusKategorie`/`Dienststatus` existieren bereits aus K&M‑1.

## Backend

Neues Domänen-Modul `src/personal/` (`mod.rs`, `repo.rs`, `qualifikation_repo.rs`, `status_repo.rs`, `disposition_repo.rs`) analog `src/fahrzeug/`. Neue Routen-Module + Registrierung in `src/routes/mod.rs`. Bootstrap (`src/auth/bootstrap.rs`) seedet für neue Orgs den Qualifikations- **und** Personal-Status-Default (analog zur bestehenden Status-/Stichwort-Seedung).

### Globaler Personal-Stamm — `src/routes/personal.rs`

- `GET /api/personal` — alle eingeloggten Nutzer (Lesen), eigene Organisation, sortiert nach Name; inkl. aufgelöster Qualifikationen. Query-Param `?nur_im_dienst=true` für die Dispositions-Auswahl.
- `GET /api/personal-vorschlaege` — abgeleitete `traegerorganisation`-Vorschläge (`SELECT DISTINCT … WHERE org_id = ? AND traegerorganisation IS NOT NULL`), eigene Org (für die AutoComplete).
- `POST /api/personal` — **Admin**. Validierung: `name` getrimmt nicht leer; `staerke_position` ∈ Enum oder leer; `personalnummer`-Dublette → `Conflict`; `benutzer_id` (falls gesetzt) muss zur eigenen Org gehören und frei sein, sonst `Validation`/`Conflict`. Optionale Qualifikations-Zuordnung im selben Request.
- `PATCH /api/personal/{id}` — **Admin**. Vollersatz der editierbaren Stammfelder + Qualifikations-Zuordnung (Lesemodus/Bearbeiten-Workflow wie Fahrzeuge). Dubletten-Regeln wie `POST`.
- `POST /api/personal/{id}/ausser-dienst` und `.../in-dienst` — **Admin**. Setzt `dienststatus` (Soft-Delete). Kein DELETE.

### Qualifikations-Katalog — `src/routes/qualifikation.rs`

- `GET /api/qualifikationen` — alle eingeloggten Nutzer (für Auswahl), eigene Org, nur `aktiv`, nach `sortier`.
- `POST /api/qualifikationen` — **Admin**. `label` nicht leer; Dublette `label` → `Conflict`.
- `PATCH /api/qualifikationen/{id}` — **Admin**. label/sortier.
- `POST /api/qualifikationen/{id}/deaktivieren` — **Admin**. `aktiv = 0` statt Löschen (bestehende Zuordnungen bleiben gültig).

### Personal-Status-Katalog — `src/routes/personal_status.rs`

- `GET /api/personal-status` — alle eingeloggten Nutzer (für Dropdowns), eigene Org, nur `aktiv`, nach `sortier`.
- `POST /api/personal-status` — **Admin**. `label` nicht leer; `kategorie` ∈ Enum; Dublette `label` → `Conflict`.
- `PATCH /api/personal-status/{id}` — **Admin**. label/kategorie/farbe/sortier.
- `POST /api/personal-status/{id}/deaktivieren` — **Admin**. `aktiv = 0` statt Löschen.

### Disposition im Einsatz — `src/routes/einsatz_personal.rs`

Gate für alle schreibenden Routen: `fordere_schreibrecht(meine_rolle)` (Einsatzleitung/Führungspersonal) **und** `fordere_aktiv(einsatz)`. Lesen: `fordere_lesezugriff`.

- `GET /api/einsaetze/{id}/personal` — disponiertes Personal des Einsatzes (aufgelöste Anzeige inkl. Status, Stärke-Position, Funktion).
- `POST /api/einsaetze/{id}/personal` — disponieren. Body entweder `{ personal_id, staerke_position? }` (Stamm; `snap_*` aus dem Stamm + Qualifikationen gefüllt, Dublette → `Conflict`) **oder** `{ adhoc: { name, funktion?, traegerorganisation?, staerke_position? } }` (Ad-hoc; `personal_id = NULL`). Initial-Status = erster `gebunden`-Status. **Schreibt ETB-Eintrag.**
- `PATCH /api/einsaetze/{id}/personal/{ep_id}` — Status, Stärke-Position und/oder Bemerkung ändern. **Status-Wechsel schreibt ETB-Eintrag.**
- `DELETE /api/einsaetze/{id}/personal/{ep_id}` — aus dem Einsatz entfernen (die Dispositionszeile; der Stamm bleibt). **Schreibt ETB-Eintrag.**

### ETB-Integration

Disponieren / Status-Wechsel / Entfernen erzeugen je einen **automatischen ETB-Eintrag** über `etb::repo::anlegen` mit **`typ = TYP_SYSTEM`** (kein client-erfassbarer Typ; bereits im ETB-Schema vorgesehen — **keine ETB-Migration nötig**). Attribuiert auf den handelnden Benutzer (`erfasser_id`), `ereigniszeit = jetzt`, `lfd_nr` server-autoritativ. Inhalt mit Personen-Identität, z. B. „*Thomas Müller (Gruppenführer)* disponiert" / „Status *alarmiert* → *im Einsatz*".

## Frontend

### `pages/StammdatenPage.tsx` (erweitern)

Das Tab-Layout aus K&M‑1 wird um drei Tabs ergänzt (kein Struktur-Umbau):
- **Personal** — Tabelle (Name, Personalnummer, Qualifikationen, Stärke-Position, Träger, Status in/außer Dienst). „Person anlegen" + Zeilen-Bearbeiten (antd `Form`/`Modal`): alle Stammfelder, Qualifikationen als Mehrfach-`Select` (aus `GET /api/qualifikationen`), Stärke-Position als `Select` (drei Werte mit deutschen Labels, leer erlaubt), Trägerorganisation als `AutoComplete`, optionaler Benutzer-Link als `Select` über die Org-Benutzer. „Außer Dienst / Wieder in Dienst" statt Löschen. **Nur Admin** editierbar; sonst read-only.
- **Qualifikationen** — Liste der Katalog-Einträge (label, Sortierung). Anlegen/Bearbeiten/Deaktivieren (Admin).
- **Personal-Status** — Liste der Katalog-Einträge (label, Kategorie-Badge, Farbe, Sortierung). Anlegen/Bearbeiten/Deaktivieren (Admin). Kategorie als `Select` (drei Werte mit deutschen Labels).

### `pages/PersonalPage.tsx` (neu) — Einsatz-Modul `/einsaetze/:id/personal`

- In `App.tsx` als echtes Modul-Element für Key `personal` registrieren (ersetzt `ModulStub`).
- In `frontend/src/einsatz/modulRegistry.ts` Eintrag `personal` von `status: 'geplant'` auf `'fertig'` setzen.
- Liste des disponierten Personals mit Status-Badge (Farbe aus Katalog), Funktion und Stärke-Position. Aktionen, sofern `meine_rolle` schreibberechtigt **und** Einsatz aktiv:
  - **„Person disponieren"** → `Select`/Suche über den Stamm-Pool (nur `in_dienst`, noch nicht im Einsatz), optionale Stärke-Position.
  - **„Ad-hoc-Person"** → kleines Formular (Name Pflicht, Funktion/Träger/Position optional).
  - **Status setzen** (Inline-`Select` aus `GET /api/personal-status`), **Stärke-Position**, **Bemerkung**, **Entfernen**.
- Beobachter / abgeschlossener Einsatz: reine Anzeige.

### API-Module

- `api/personal.ts`: `listePersonal(nurImDienst?)`, `legePersonAn`, `aktualisierePerson`, `setzeDienststatus`.
- `api/qualifikationen.ts`: `listeQualifikationen`, `legeQualifikationAn`, `aktualisiereQualifikation`, `deaktiviereQualifikation`.
- `api/personalStatus.ts`: `listePersonalStatus`, `legeStatusAn`, `aktualisiereStatus`, `deaktiviereStatus`.
- `api/einsatzPersonal.ts`: `listeEinsatzPersonal(einsatzId)`, `disponierePerson`, `disponiereAdhoc`, `aktualisiereDisposition`, `entferneDisposition`.

## Tests

### Backend
- **Stamm-Gating:** `GET` für alle; `POST`/`PATCH`/`ausser-dienst` nur Admin (sonst `Forbidden`).
- **Personalnummer-Eindeutigkeit:** Dublette je Org (unter aktiven) → `Conflict`; verschiedene Orgs unabhängig; `NULL`-Personalnummer mehrfach erlaubt; Namens-Dubletten erlaubt.
- **Benutzer-Link:** `benutzer_id` einer fremden Org → `Validation`; bereits verknüpftes Konto → `Conflict`; mehrere Personen ohne Link erlaubt.
- **Stärke-Position-Validierung:** Wert außerhalb Enum → `Validation`; `NULL` erlaubt.
- **Soft-Delete:** `ausser-dienst` setzt Flag; Person verschwindet aus `?nur_im_dienst=true`, bleibt referenzierbar; kein DELETE-Endpunkt.
- **Qualifikations-Katalog & Zuordnung:** `GET` für alle; CRUD nur Admin; Dublette `label` → `Conflict`; Deaktivieren statt Löschen; n:m-Zuordnung beim Anlegen/Bearbeiten korrekt gesetzt; deaktivierte Qualifikation bleibt in bestehender Zuordnung sichtbar.
- **Status-Katalog:** `GET` für alle; CRUD nur Admin; `kategorie` außerhalb Enum → `Validation`; Dublette `label` → `Conflict`; Deaktivieren statt Löschen, referenzierte Dispositionen bleiben gültig.
- **Disposition-Gating:** Einsatzleitung ✓, Führungspersonal ✓, Beobachter → `Forbidden`, Nicht-Mitglied → `Forbidden`; auf abgeschlossenem Einsatz → `Conflict` (409).
- **Disposition Stamm vs. Ad-hoc:** Stamm-Dispo füllt `snap_*` (inkl. `snap_funktion` aus den aktiven Qualifikationen) aus dem Stamm; dieselbe Person doppelt → `Conflict`; Ad-hoc ohne `personal_id` mit Pflicht-`name`; mehrere Ad-hoc erlaubt.
- **Stärke-Position-Auflösung:** Dispo-Override schlägt Stamm-Default; ohne Override greift Stamm-Default; Ad-hoc nutzt nur das Dispo-Feld; `StaerkePosition::parse`/`as_str` Roundtrip; `Staerke::aus_positionen` zählt korrekt je Topf.
- **Schnappschuss-Stabilität:** nachträgliche Stamm-/Qualifikations-Änderung lässt `snap_*` unverändert; Anzeige-Auflösung liefert Live-Daten bei aktivem Einsatz, Snapshot bei außer Dienst / abgeschlossen.
- **ETB-Eintrag:** Disponieren/Status-Wechsel/Entfernen erzeugen je einen ETB-Eintrag (`typ='system'`) mit Personen-Identität.
- **Org-Isolation:** Nutzer aus Org A kann Personal / Qualifikationen / Status-Katalog / Dispositionen aus Org B weder lesen noch ändern (`GET` liefert nichts Fremdes; `POST`/`PATCH`/`DELETE` auf fremde IDs → `Forbidden`/`NotFound`).

### Frontend
- Stammdaten-Tabs: Admin sieht Anlegen/Bearbeiten/Außer-Dienst und Katalog-CRUD (Qualifikationen, Status); Nicht-Admin read-only.
- Qualifikations-Mehrfachauswahl listet nur aktive Qualifikationen; Stärke-Position-Select bietet drei Werte + leer.
- `PersonalPage`: Disponieren aus Pool, Ad-hoc anlegen, Status setzen, Stärke-Position setzen, Entfernen — nur bei Schreibrecht **und** aktivem Einsatz; Beobachter/abgeschlossen reine Anzeige.
- Status-Badge nutzt Katalog-Farbe; Auswahl listet nur aktive Stati.
- **Registry/Regression:** `personal` rendert die echte Seite statt Stub; bestehende Einsatz-/ETB-/Fahrzeug-Tests bleiben grün.

## Offene Punkte / Folge-Specs

- **UX des Ad-hoc-Flows** im Einsatz-Modul wird in der Umsetzung geschärft (Quick-Add vs. Dialog, Felder-Reihenfolge) — wie bei K&M‑1.
- **Genaue ETB-Eintragstexte** im Plan festlegen.
- **SSE-Live** der Dispositions-Liste über Clients hinweg — Folge.
- **Wo `StatusKategorie`-Konstanten/Validierung leben** (heute in `src/fahrzeug/mod.rs`) — ggf. in ein neutrales Modul ziehen, damit `fahrzeug` und `personal` denselben Code teilen; im Plan zu entscheiden.
- **K&M‑3 Einheiten** verwendet `StaerkePosition`/`Staerke::aus_positionen` und das Dispositions-Pattern wieder; **K&M‑4 Material** verwendet Stamm/Status-Pattern wieder.
- **Verschärfte PII-/Datenschutz-Rechte** für Personal-Kontaktdaten — eigenes Backlog-Thema.
