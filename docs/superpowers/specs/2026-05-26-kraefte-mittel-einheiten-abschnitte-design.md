# K&M‑3 — Taktische Einheiten & Einsatzabschnitte

**Datum:** 2026-05-26
**Status:** Design abgestimmt, bereit für Implementierungsplan
**Teilprojekt:** 2 „Kräfte & Mittel" — Spec 3 von 4. Komponiert die in [K&M‑1](2026-05-26-kraefte-mittel-fahrzeuge-disposition-design.md) (Fahrzeuge) und [K&M‑2](2026-05-26-kraefte-mittel-personal-disposition-design.md) (Personal) disponierten Kräfte zu taktischen Einheiten und gliedert den Einsatz in Abschnitte.
**Vorgänger:** [K&M‑2 Personal](2026-05-26-kraefte-mittel-personal-disposition-design.md) — legte fest: „Die Summe der Dispositionszeilen liefert später (K&M‑3) die Einheiten-Stärke" und baute `Staerke::aus_positionen` genau dafür. Im [Navigations-Redesign](2026-05-25-navigation-redesign-design.md) sind „Einheiten" (Kategorie *Kräfte & Mittel*) und „Einsatzabschnitte" (Kategorie *Führung*) zwei `geplant`-Module (heute `ModulStub`).

## Problem

K&M‑1/2 haben Fahrzeuge und Personal als globale Stämme nutzbar gemacht und in den Einsatz disponierbar. Was fehlt, ist die **taktische Gliederung**: disponierte Kräfte zu **Einheiten** bündeln (Trupp/Staffel/Gruppe/Zug …), diese einer **Führungskette** (Über-/Unterstellung) zuordnen und den Einsatz in **Einsatzabschnitte** gliedern. Die taktische Einheit ist laut Navigations-Spec „das zentrale operative Objekt": sie bündelt Führer + Mannschaft + ggf. Fahrzeuge und wird einem Einsatzabschnitt zugeordnet; Personal und Fahrzeuge sind die Bausteine darin.

Diese Spec baut beide Module zusammen, weil eine Einheit ohne Abschnitt zur Zuordnung halb ist und ein Abschnitt ohne Einheiten leer.

## Gesetzte Annahmen (aus K&M‑1/2 übernommen, nicht neu verhandelt)

- **Komposition aus bestehenden Dispozeilen.** Eine Einheit *gruppiert* bereits disponierte `einsatz_personal`/`einsatz_fahrzeug`-Zeilen (Mitgliedschaft = Zuordnung, **kein** Auto-Disponieren). Die Einheiten-Stärke ergibt sich aus der Aggregation dieser Zeilen.
- **ETB als Historie.** Sinntragende Ereignisse werden als ETB-Einträge (`typ = system`) mitgeschrieben — bestehendes Schema, keine ETB-Migration.
- **Schreibrechte-Gate.** Operative Schreibaktionen → Einsatzleitung + Führungspersonal; Beobachter lesend; **abgeschlossener Einsatz = read-only** (`fordere_aktiv`). Globale Stammdaten (Typ-Katalog) → System-Admin.
- **Wiederverwendbare Stärke.** `Staerke`, `StaerkePosition`, `Staerke::aus_positionen`, `Staerke::aus_optionen` aus `src/staerke.rs` bestehen bereits und werden unverändert genutzt.

## Abgestimmte Entscheidungen

1. **Scope = Einheiten *und* Einsatzabschnitte** in einer Spec. Beide Module werden `fertig`; die Abschnitts-Zuordnung der Einheit ist eine echte relationale Referenz, kein Freitext-Stub.
2. **Einheit ist einsatz-scoped**, kein globaler Stamm. Tabelle `einsatz_einheit`; taktische Gliederung ist einsatzspezifisch. Wiederkehrende Kompositionen (Vorlagen) sind bewusst draußen (späteres Thema).
3. **Beide Gliederungen sind Bäume.** Einsatzabschnitte hierarchisch (Abschnitt → Unterabschnitt); Einheiten hierarchisch (Über-/Unterstellung, Zug → Gruppen). Zwei unabhängige Selbstreferenz-Bäume mit app-seitigem Zyklen-Schutz.
4. **Einheitstyp-Katalog mit Soll-Stärke.** Org-weiter, admin-pflegbarer Katalog `einheit_typ` (Pattern wie `fahrzeug_status`: deaktivieren statt löschen) mit optionaler Standard-Soll-Stärke. Die Einheit referenziert einen Typ und kann die Soll-Stärke überschreiben.
5. **Mitgliedschaft = exklusiv (max. 1 Einheit).** Eine disponierte Kraft gehört zu höchstens einer Einheit. Umgesetzt über eine FK-Spalte `einheit_id` direkt an `einsatz_personal`/`einsatz_fahrzeug` (Exklusivität per Konstruktion); `NULL` = freie, nicht zugeordnete Kraft. Kein Join-Table.
6. **Führer & Abschnittsleiter referenzieren `einsatz_personal`** (eine bereits disponierte Person), konsistent zur Komposition aus bestehenden Dispozeilen. Externe Führung wird vorher ad-hoc disponiert. Der Einheitsführer muss Mitglied *seiner* Einheit sein.
7. **Abgeleitete Stärke, nicht gespeichert.** Ist-Stärke = Aggregation der Personal-Positionen der Mitglieder (Fahrzeuge zählen nicht in F/UF/M); zusätzlich kumulierte Ist-Stärke inkl. unterstellter Einheiten (rekursiv). Soll = Override der Einheit, sonst aus dem Typ.
8. **Auflösen statt Löschen-mit-Kollateral.** Einheit auflösen gibt Mitglieder frei und zieht Unter-Einheiten eine Ebene hoch; Abschnitt auflösen zieht Unter-Abschnitte hoch und setzt `einsatz_einheit.abschnitt_id` der betroffenen Einheiten auf `NULL`. Jeweils in einer Transaktion.

## Scope-Abgrenzung

**Drin:**
- **Einsatzabschnitt-Baum** (CRUD, Reparenting beim Auflösen) im Führungs-Modul.
- **Einheiten-Baum** (CRUD, Über-/Unterstellung) im Kräfte-&-Mittel-Modul.
- **Einheitstyp-Katalog** mit Soll-Stärke (CRUD, Deaktivieren) im Stammdaten-Bereich.
- **Mitglieder-Zuordnung** Personal/Fahrzeuge zur Einheit (exklusiv), Freigeben.
- **Einheitsführer** (Mitglied der Einheit) und **Abschnittsleiter** (disponierte Person).
- **Soll/Ist-Stärke** je Einheit (eigene + kumuliert), abgeleitet.
- **ETB-Einträge** für sinntragende Ereignisse.

**Draußen (eigene/spätere Specs):**
- **Material**-Mitglieder einer Einheit — K&M‑4.
- **Einheiten-Vorlagen / wiederkehrende Kompositionen** (stehende Einheiten).
- **Lagekarten-Darstellung** der Gliederung (taktische Zeichen) — Lage-Modul.
- **Kräfteübersicht / Meldebild** — Lage-Modul.
- **Mehrfach-Mitgliedschaft** einer Kraft in mehreren Einheiten.
- **Auftrags-/Befehls-Zuordnung** an Einheiten — Kommunikations-Modul.
- **SSE-Live-Aktualisierung** über Clients hinweg — Folge (spiegelt vorerst über Refetch/Invalidierung und die live geschriebenen ETB-Einträge).

## Datenmodell

### Migration `0014_einsatzabschnitt.sql` — Abschnitts-Baum (einsatzbezogen)

```sql
CREATE TABLE einsatzabschnitt (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    ueber_abschnitt_id INTEGER REFERENCES einsatzabschnitt(id),   -- NULL = oberste Ebene
    name               TEXT NOT NULL,
    leiter_id          INTEGER REFERENCES einsatz_personal(id),   -- Abschnittsleiter, optional
    bemerkung          TEXT,
    sortier            INTEGER NOT NULL DEFAULT 0,
    angelegt_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_einsatzabschnitt_einsatz ON einsatzabschnitt(einsatz_id);
```

- **Baum** über `ueber_abschnitt_id` (Selbstreferenz). Zyklen-Schutz app-seitig (ein Abschnitt darf nicht eigener Vorfahr werden — direkt oder transitiv).
- **`leiter_id`** ist eine optionale Referenz auf eine disponierte Person des Einsatzes; muss zum selben Einsatz gehören.
- Name bewusst **nicht** eindeutig (zwei „Abschnitt Nord" auf verschiedenen Ebenen erlaubt).

### Migration `0015_einheit_typ.sql` — Einheitstyp-Katalog (org-weit, admin-pflegbar)

```sql
CREATE TABLE einheit_typ (
    id                INTEGER PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organisation(id),
    label             TEXT NOT NULL,
    soll_fuehrer      INTEGER,   -- Soll-Stärke-Default; alle drei oder keiner
    soll_unterfuehrer INTEGER,
    soll_mannschaft   INTEGER,
    sortier           INTEGER NOT NULL DEFAULT 0,
    aktiv             INTEGER NOT NULL DEFAULT 1,  -- Soft-Delete (deaktivieren statt löschen)
    UNIQUE(org_id, label)
);
```

**Seed-Default je Organisation** (gespiegelt im Admin-Bootstrap + bestehende Org in der Migration):

| label | soll (F/UF/M/Gesamt) |
|---|---|
| Trupp | 0/0/2/2 |
| Staffel | 0/1/5/6 |
| Gruppe | 0/1/8/9 |
| Zug | 1/3/18/22 |
| Sonstige | – (Soll leer) |

- **Soll-Stärke** nullable, Regel „alle drei oder keiner" via `Staerke::aus_optionen`.
- **Deaktivieren statt Löschen**: ein deaktivierter Typ bleibt für bestehende Einheiten-Referenzen gültig, erscheint aber nicht mehr in der Auswahl.

### Migration `0016_einsatz_einheit.sql` — Einheiten-Baum (einsatzbezogen)

```sql
CREATE TABLE einsatz_einheit (
    id                INTEGER PRIMARY KEY,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id      INTEGER REFERENCES einsatzabschnitt(id),   -- zugeordneter Abschnitt, optional
    ueber_einheit_id  INTEGER REFERENCES einsatz_einheit(id),    -- übergeordnete Einheit, optional
    typ_id            INTEGER REFERENCES einheit_typ(id),        -- Einheitstyp, optional
    name              TEXT NOT NULL,                             -- z. B. "1. Zug", "Gruppe Florian 1"
    fuehrer_id        INTEGER REFERENCES einsatz_personal(id),   -- Einheitsführer (muss Mitglied sein), optional
    soll_fuehrer      INTEGER,   -- Soll-Override (sonst aus typ); alle drei oder keiner
    soll_unterfuehrer INTEGER,
    soll_mannschaft   INTEGER,
    bemerkung         TEXT,
    sortier           INTEGER NOT NULL DEFAULT 0,
    angelegt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    angelegt_von      INTEGER REFERENCES benutzer(id)
);

CREATE INDEX idx_einsatz_einheit_einsatz ON einsatz_einheit(einsatz_id);
```

- **Zwei unabhängige Referenzen:** `abschnitt_id` (wo die Einheit wirkt) und `ueber_einheit_id` (wem sie untersteht). Beide optional; beide `NULL` = „direkt unter EL / noch nicht zugeordnet".
- **Zyklen-Schutz** im Einheiten-Baum (Einheit darf nicht eigener Vorfahr werden).
- **`fuehrer_id`** muss eine Person sein, deren `einsatz_personal.einheit_id` auf *diese* Einheit zeigt (Validierung); optional.
- **Soll-Override** nullable, „alle drei oder keiner"; bei `NULL` greift die Soll-Stärke des Typs.

### Migration `0017_einheit_mitgliedschaft.sql` — Mitgliedschaft (FK-Spalte, exklusiv)

```sql
ALTER TABLE einsatz_personal ADD COLUMN einheit_id INTEGER REFERENCES einsatz_einheit(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN einheit_id INTEGER REFERENCES einsatz_einheit(id);
```

- `einheit_id = NULL` → freie, noch nicht zugeordnete Kraft. Genau eine Einheit je Kraft (Exklusivität per Spalte).
- Die FK bleibt ohne `ON DELETE`-Aktion (SQLite-Grenze beim nachträglichen `ADD COLUMN`); das **Freigeben beim Auflösen** der Einheit passiert explizit in einer Repo-Transaktion (robuster als FK-Action auf ergänzter Spalte).

### Typen (`src/einsatzabschnitt/mod.rs`, `src/einheit/mod.rs`, neu)

- `Einsatzabschnitt` (`FromRow`), `EinsatzabschnittAnzeige` (`Serialize`, inkl. aufgelöstem Leiter-Namen).
- `EinheitTyp` (Katalog-Eintrag, `Serialize`/`FromRow`, inkl. aufgelöster Soll-`Staerke`).
- `EinsatzEinheit` (`FromRow`), `EinheitAnzeige` (`Serialize`): aufgelöste Sicht inkl. Typ-Label, Abschnitt, `ueber_einheit_id`, Führer-Identität, Mitglieder (Personal + Fahrzeuge) und berechneter Stärke `soll` / `ist` / `ist_kumuliert: Staerke`.

### Frontend-Typen (`frontend/src/api/types.ts`)

`EinheitTyp`, `Einsatzabschnitt`, `Einheit` (inkl. `soll`/`ist`/`ist_kumuliert: Staerke`, Mitglieder, Führer). `Staerke`/`StaerkePosition` existieren bereits aus K&M‑1/2.

### Stärke-Wiederverwendung (`src/staerke.rs`)

Unverändert genutzt: `Staerke::aus_positionen` (Ist aus Mitglieds-Positionen) und `aus_optionen` (Soll-Validierung). Die **kumulierte** Ist-Stärke ist ein dünner rekursiver Wrapper im Einheiten-Repo (summiert eigene + unterstellte), keine neue Stärke-Logik.

## Backend

Neue Domänen-Module analog `src/fahrzeug/` / `src/personal/`:
- `src/einsatzabschnitt/` — `mod.rs`, `repo.rs` (CRUD, Baum-Helfer, Zyklen-Check, Auflösen mit Reparenting).
- `src/einheit/` — `mod.rs`, `repo.rs` (CRUD, Zyklen-Check, Auflösen mit Mitglieder-Freigabe + Reparenting), `typ_repo.rs` (Typ-Katalog), `mitglied_repo.rs` (Zuordnen/Freigeben + Stärke-Aggregation).

Neue Routen-Module + Registrierung in `src/routes/mod.rs`. Bootstrap (`src/auth/bootstrap.rs`) seedet für neue Orgs den `einheit_typ`-Default.

**Gate für alle schreibenden Einsatz-Routen:** `fordere_schreibrecht(meine_rolle)` (Einsatzleitung/Führungspersonal) **und** `fordere_aktiv(einsatz)`. Lesen: `fordere_lesezugriff`. Typ-Katalog: **Admin**.

### Einsatzabschnitte — `src/routes/einsatzabschnitt.rs` (Führung)

- `GET /api/einsaetze/{id}/abschnitte` — flache Liste mit `ueber_abschnitt_id` (Baum baut das FE); inkl. aufgelöstem Leiter-Namen.
- `POST /api/einsaetze/{id}/abschnitte` — `name` nicht leer; `ueber_abschnitt_id` (falls gesetzt) selber Einsatz + zyklenfrei; `leiter_id` (falls gesetzt) disponierte Person des Einsatzes. **ETB-Eintrag.**
- `PATCH /api/einsaetze/{id}/abschnitte/{aid}` — name/parent/leiter/bemerkung/sortier; Parent-Wechsel zyklenfrei.
- `DELETE /api/einsaetze/{id}/abschnitte/{aid}` — Transaktion: Unter-Abschnitte auf den Parent des gelöschten hochziehen, Einheiten mit diesem `abschnitt_id` auf `NULL`. **ETB-Eintrag.**

### Einheiten — `src/routes/einsatz_einheit.rs` (Kräfte & Mittel)

- `GET /api/einsaetze/{id}/einheiten` — Liste mit aufgelösten Mitgliedern (Personal + Fahrzeuge), Führer, Typ, Abschnitt, `ueber_einheit_id` und berechneter Soll/Ist-Stärke (eigene + kumuliert).
- `POST /api/einsaetze/{id}/einheiten` — `name` nicht leer; `typ_id`/`abschnitt_id`/`ueber_einheit_id` (falls gesetzt) gültig + selber Einsatz/Org; Soll-Override vollständig oder leer. **ETB-Eintrag.**
- `PATCH /api/einsaetze/{id}/einheiten/{eid}` — name/typ/abschnitt/parent/soll/bemerkung/sortier; Parent-Wechsel zyklenfrei; **Führer setzen** (`fuehrer_id` muss Mitglied *dieser* Einheit sein, sonst `Validation`). Führer-Wechsel → **ETB-Eintrag.**
- `DELETE /api/einsaetze/{id}/einheiten/{eid}` — auflösen, Transaktion: alle Mitglieder freigeben (`einheit_id` → `NULL`), Unter-Einheiten auf den Parent hochziehen, `fuehrer_id`-Verweise bereinigt. **ETB-Eintrag.**

**Mitglieder (modifizieren die Dispozeilen):**
- `PUT /api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}` — Person zuordnen (setzt `einheit_id`; aus anderer Einheit → wechselt). **ETB-Eintrag.**
- `DELETE /api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}` — freigeben (`einheit_id` → `NULL`); war sie Führer, wird `fuehrer_id` geleert. **ETB-Eintrag.**
- `PUT`/`DELETE /api/einsaetze/{id}/einheiten/{eid}/fahrzeug/{ef_id}` — analog für Fahrzeuge.

### Einheitstyp-Katalog — `src/routes/einheit_typ.rs` (Stammdaten)

- `GET /api/einheit-typen` — alle eingeloggten Nutzer (für Auswahl), eigene Org, nur `aktiv`, nach `sortier`.
- `POST /api/einheit-typen` — **Admin**. `label` nicht leer; Soll vollständig oder leer; Dublette `label` → `Conflict`.
- `PATCH /api/einheit-typen/{id}` — **Admin**. label/soll/sortier.
- `POST /api/einheit-typen/{id}/deaktivieren` — **Admin**. `aktiv = 0` statt Löschen; referenzierte Einheiten bleiben gültig.

### ETB-Integration

Über `etb::repo::anlegen` mit `typ = TYP_SYSTEM` (bereits im Schema, keine ETB-Migration), attribuiert auf den handelnden Benutzer (`erfasser_id`), `ereigniszeit = jetzt`, `lfd_nr` server-autoritativ. **Bewusst nur sinntragende Ereignisse** (kein ETB-Spam): Einheit gebildet/aufgelöst, Abschnitt angelegt/aufgelöst, Mitglied zugeordnet/freigegeben, Führer gesetzt/gewechselt, Abschnitts-Zuordnung geändert. Reine `name`/`sortier`-Korrekturen erzeugen keinen Eintrag. Genaue Eintragstexte im Plan.

## Frontend

### Modul-Registry (`frontend/src/einsatz/modulRegistry.ts`)

`einsatzabschnitte` (Führung) und `einheiten` (Kräfte & Mittel) von `status: 'geplant'` auf `'fertig'`. In `App.tsx` beide als echte Modul-Elemente registrieren (ersetzen `ModulStub`).

### `pages/EinheitenPage.tsx` (neu) — `/einsaetze/:id/einheiten`

Taktisches Arbeitsmodul, Layout **Baum links, Detail rechts**.
- **Einheiten-Baum** (antd `Tree` nach `ueber_einheit_id`): je Knoten Name, Typ-Badge, Soll/Ist-Stärke (`1/3/18/22`-Anzeige, Ist farblich vs. Soll), Abschnitts-Chip, Führer.
- **Detail-Panel** der gewählten Einheit:
  - Kopf: Name, Typ (`Select` aus `GET /api/einheit-typen`), Abschnitt (`TreeSelect` aus Abschnitten), Über-Einheit (`TreeSelect`, zyklenfrei gefiltert), Soll-Override (drei `InputNumber`, sonst Typ-Default angezeigt), Bemerkung.
  - **Mitglieder**: zwei Listen (Personal / Fahrzeuge) mit Stärke-Position bzw. Funktion. „Kraft zuordnen" öffnet einen Picker über die **freien** Kräfte des Einsatzes (`einheit_id IS NULL`) aus disponiertem Personal/Fahrzeugen. Mitglied entfernen → wird wieder frei. **Führer setzen** per Markierung eines Personal-Mitglieds.
- Aktionen „Einheit bilden" / „Auflösen". Auflösen warnt: Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch.
- Beobachter / abgeschlossener Einsatz: reine Anzeige.

### `pages/EinsatzabschnittePage.tsx` (neu) — `/einsaetze/:id/einsatzabschnitte`

Gliederungs-Sicht (Führung).
- **Abschnitts-Baum** (antd `Tree` nach `ueber_abschnitt_id`): je Knoten Name, Abschnittsleiter, und read-only verlinkt die diesem Abschnitt zugeordneten Einheiten (mit kumulierter Stärke des Abschnitts).
- Anlegen/Bearbeiten/Auflösen von Abschnitten; Leiter als `Select` über disponiertes Personal; Parent als `TreeSelect` (zyklenfrei).
- Auflösen warnt: Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet".
- Schreibrecht-Gate identisch (Beobachter/abgeschlossen read-only).

*Arbeitsteilung:* Abschnitte = **wo** (Gliederung, Abschnittsleiter), Einheiten = **wer/womit** (Komposition + Führungskette). Sie verlinken aufeinander, duplizieren aber keine Bearbeitung: die Abschnitts-Zuordnung einer Einheit wird auf der Einheiten-Seite gesetzt, die Abschnitts-Struktur auf der Abschnitte-Seite.

### `pages/StammdatenPage.tsx` (erweitern)

Neuer Tab **Einheitstypen** (zum bestehenden Tab-Layout aus K&M‑1): Liste der Katalog-Einträge (Label, Soll-Stärke `0/1/8/9`, Sortierung), Anlegen/Bearbeiten/Deaktivieren — **nur Admin**, sonst read-only. Soll-Stärke als drei `InputNumber` (vollständig oder leer).

### API-Module

- `api/einheitTypen.ts`: `listeEinheitTypen`, `legeTypAn`, `aktualisiereTyp`, `deaktiviereTyp`.
- `api/einsatzabschnitte.ts`: `listeAbschnitte`, `legeAbschnittAn`, `aktualisiereAbschnitt`, `loeseAbschnittAuf`.
- `api/einheiten.ts`: `listeEinheiten`, `bildeEinheit`, `aktualisiereEinheit`, `loeseEinheitAuf`, `ordnePersonalZu`/`gibPersonalFrei`, `ordneFahrzeugZu`/`gibFahrzeugFrei`.

## Tests

### Backend
- **Gating:** Abschnitt-/Einheiten-`GET` für alle Einsatz-Mitglieder; schreibende Routen nur Einsatzleitung/Führungspersonal (Beobachter → `Forbidden`); auf abgeschlossenem Einsatz → `Conflict`. Typ-Katalog-CRUD nur Admin.
- **Zyklen-Schutz:** Abschnitt/Einheit als eigener Vorfahr (direkt und transitiv) → `Validation`; Parent in fremdem Einsatz → `Forbidden`/`NotFound`.
- **Mitgliedschaft-Exklusivität:** Zuordnen einer bereits zugeordneten Kraft wechselt die Einheit (alte verliert sie); Freigeben setzt `einheit_id = NULL`; freie Kräfte erscheinen im Picker, zugeordnete nicht.
- **Führer-Regel:** `fuehrer_id` muss Mitglied *dieser* Einheit sein (sonst `Validation`); Freigeben des Führer-Mitglieds leert `fuehrer_id`.
- **Soll/Ist-Stärke:** Soll-Override vollständig-oder-leer (`aus_optionen`); Ist = Aggregation der Personal-Positionen (Fahrzeuge zählen nicht); kumulierte Stärke summiert unterstellte Einheiten rekursiv korrekt.
- **Auflösen:** Einheit auflösen gibt Mitglieder frei + zieht Unter-Einheiten hoch; Abschnitt auflösen zieht Unter-Abschnitte hoch + setzt Einheiten-`abschnitt_id` auf `NULL`.
- **Typ-Katalog:** `GET` für alle; CRUD nur Admin; Dublette `label` → `Conflict`; Deaktivieren statt Löschen, referenzierte Einheiten bleiben gültig.
- **ETB-Eintrag:** Bilden/Auflösen, Mitglied zuordnen/freigeben, Führer setzen erzeugen je einen `typ='system'`-Eintrag.
- **Org-Isolation** (gemäß bekannter Cross-Org-Lesezugriff-Lücke explizit geprüft): Nutzer aus Org A kann Abschnitte/Einheiten/Typen/Mitgliedschaften aus Org B weder lesen noch ändern (`GET` liefert nichts Fremdes; `POST`/`PATCH`/`PUT`/`DELETE` auf fremde IDs → `Forbidden`/`NotFound`).

### Frontend
- Einheiten-Seite: Bilden, Typ/Abschnitt/Parent setzen, Mitglieder zuordnen/freigeben aus dem Frei-Pool, Führer markieren, Auflösen — nur bei Schreibrecht **und** aktivem Einsatz; Beobachter/abgeschlossen reine Anzeige.
- Soll/Ist-Stärke-Anzeige; `TreeSelect` für Parent filtert Zyklen aus.
- Abschnitte-Seite: Baum-CRUD, Leiter setzen, zugeordnete Einheiten read-only sichtbar.
- Stammdaten-Tab Einheitstypen: Admin CRUD/Deaktivieren; Nicht-Admin read-only.
- **Registry/Regression:** `einheiten` und `einsatzabschnitte` rendern echte Seiten statt Stub; bestehende Einsatz-/ETB-/Fahrzeug-/Personal-Tests bleiben grün.

## Offene Punkte / Folge-Specs

- **Genaue ETB-Eintragstexte** im Plan festlegen (mit Einheits-/Abschnitts-Identität).
- **UX des Mitglieder-Pickers** (Quick-Add vs. Dialog, Mehrfachauswahl) in der Umsetzung schärfen.
- **Default-Abschnitt für Unter-Einheiten:** FE belegt den Abschnitt der Über-Einheit vor; ob das beim Parent-Wechsel automatisch nachgezogen wird, im Plan entscheiden.
- **Einheiten-Vorlagen / wiederkehrende Kompositionen** — eigenes späteres Thema.
- **K&M‑4 Material** verwendet Stamm/Status-Pattern und die Mitgliedschafts-Idee (Material an Einheit) wieder.
- **Lagekarte / Kräfteübersicht** stellen die hier gebaute Gliederung dar — Lage-Specs.
- **SSE-Live** der Bäume über Clients hinweg — Folge.
