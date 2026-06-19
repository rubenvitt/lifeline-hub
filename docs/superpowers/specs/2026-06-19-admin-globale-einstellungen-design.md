# Globale Einstellungen + Admin-Bereich — Design

> Refactor: Org-weite Einstellungen aus den Einsatz-Einstellungen (LFH-55) herauslösen
> und mit der bestehenden Stammdaten-View in einem neuen `/admin`-Bereich zusammenführen.
> Per-Einsatz bleibt nur, was je Lage variiert; org-weite Konventionen/Policies werden
> Org-Defaults mit optionalem Pro-Einsatz-Override.

## Kontext & Problem

Die Einsatz-Einstellungen (LFH-55, Tabelle `einsatz_einstellungen`, Seite
`frontend/src/pages/EinsatzEinstellungenPage.tsx` unter `/einsaetze/:id/einsatz-einstellungen`)
mischen zwei Naturen:

- **Pro Einsatz** (variiert je Lage): Default-Modul/Einstieg, Karten-Defaults
  (Basemap/Lage-Layer/Zoom), Modul-Sichtbarkeit-Override (LFH-132).
- **Org-weit** (Konvention/Policy, variiert praktisch nie pro Einsatz): Anzeige-Konventionen,
  Aufbewahrung/Retention, Nummernkreis-Präfixe + Default-Fristen + Auto-ETB, Modul-Rollen-Default.

Die org-weiten Settings gehören nicht in den einzelnen Einsatz, sondern in eine zentrale
Admin-View — zusammen mit der heutigen Stammdaten-View (`/stammdaten`, gated
`admin|fuehrungskraft`, 10 Katalog-Tabs).

## Entscheidungen (Checkpoint mit User)

1. **Global werden:** Anzeige-Konventionen, Aufbewahrung/Retention, Nummernkreis-Präfixe +
   Default-Fristen + Auto-ETB, Modul-Rollen-Default (`benoetigteRolle`).
2. **Semantik:** Global-Default + optionaler Pro-Einsatz-Override.
   Effektivwert = **Einsatz-Override ?? Org-Default ?? hartkodierter Fallback**.
3. **Struktur:** Neuer `/admin`-Bereich mit zwei Sektionen — Stammdaten (Kataloge) +
   Einstellungen (global).
4. **Berechtigung:** Sehen `admin|fuehrungskraft` (wie Stammdaten heute); globale
   Einstellungen **ändern nur `system_rolle=admin`**.
5. **Backend-Ansatz:** Neue `org_einstellungen`-Tabelle (1 Zeile/Org) + Resolver;
   spiegelt das bestehende `einsatz/einstellungen.rs`-Muster.

## Architektur

### Frontend — `/admin`-Shell

Neuer `AdminLayout` mit Sub-Navigation, gated `admin|fuehrungskraft`:
- **`/admin/stammdaten`** — die heutige `StammdatenPage` (10 Katalog-Tabs) zieht hierher um.
- **`/admin/einstellungen`** — neue `GlobalEinstellungenPage` (org-weite Defaults).

Header-Link (`AppLayout.tsx`) `/stammdaten` → `/admin` (Label **„Verwaltung"**).
Alt-Route `/stammdaten` redirectet dauerhaft auf `/admin/stammdaten` (keine toten Links/Bookmarks).

`GlobalEinstellungenPage`-Sektionen (Edit nur für admin, sonst read-only Anzeige):
- **Anzeige-Konventionen**: Zeitzone, Zeitformat, Einheiten, Koordinatenformat.
- **Aufbewahrung**: Retention-Dauer (Tage).
- **Verhalten & Automatik**: ETB-/Meldungs-/Auftrags-Nummern-Präfix, Default-Bestätigungsfrist,
  Default-Quittierungsfrist, Auto-ETB-Schalter.
- **Modul-Rollen-Default**: je Modul-Key ein `benoetigte_rolle`-Select (admin|fuehrungskraft|frei).

### Backend — Speicherung

Neue Tabelle **`org_einstellungen`** (ADD-COLUMN-freundliches 1:1-Leaf pro Org, kein CHECK):

```sql
CREATE TABLE org_einstellungen (
    org_id                         INTEGER PRIMARY KEY REFERENCES organisation(id) ON DELETE CASCADE,
    zeitzone                       TEXT,
    zeitformat                     TEXT,
    einheiten                      TEXT,
    koordinatenformat              TEXT,
    retention_dauer_tage           INTEGER,
    etb_nummer_praefix             TEXT,
    meldung_nummer_praefix         TEXT,
    auftrag_nummer_praefix         TEXT,
    meldung_bestaetigung_frist_min INTEGER,
    auftrag_quittierung_frist_min  INTEGER,
    auto_etb_eintraege             INTEGER,   -- 0/1, NULL = an
    geaendert_at                   TEXT,
    geaendert_von                  INTEGER REFERENCES benutzer(id)
);
```

Neue Tabelle **`org_modul_einstellung`** für den Modul-Rollen-Default:

```sql
CREATE TABLE org_modul_einstellung (
    org_id           INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    modul_key        TEXT    NOT NULL,
    benoetigte_rolle TEXT,                    -- 'admin' | 'fuehrungskraft' | NULL = frei
    PRIMARY KEY (org_id, modul_key)
);
```

Domain `src/org/einstellungen.rs` spiegelt `src/einsatz/einstellungen.rs`
(FromRow-Struct, `anzeige()`, `Daten`-Input, `laden_oder_default(org_id)`, `speichern`-UPSERT).
**Validatoren wiederverwendet** aus `einsatz::einstellungen` (`ist_gueltige_zeitzone`,
`ist_gueltiges_zeitformat`, `ist_gueltiges_einheiten_system`, `ist_gueltiges_koordinatenformat`,
`ist_gueltiges_nummer_praefix`, `ist_gueltige_frist_min`, `ist_gueltige_retention_dauer`) und
`einsatz::modul` (`ist_gueltiger_modul_key`, `ist_gueltige_benoetigte_rolle`).
**Startwerte (`*_nummer_start`) bekommen KEINEN Org-Default** — sie bleiben rein pro Einsatz
(zählen je Einsatz hoch). Sie verbleiben nur auf `einsatz_einstellungen`.

### Backend — Resolver (der Kern)

Ein Resolver liefert je Einsatz die **effektiven** Werte:

```
effektiv(feld) = einsatz_einstellungen.feld   (Override, falls nicht NULL)
              ?? org_einstellungen.feld        (Org-Default, falls nicht NULL)
              ?? hartkodierter Fallback        (wie heute)
```

Implementiert als reine, testbare Funktion(en) über (geladene `EinsatzEinstellungen`,
geladene `OrgEinstellungen`). Konsumenten stellen vom direkten `einsatz_einstellungen`-Zugriff
auf den Effektivwert um:

| Konsument | Heute | Nach Refactor |
|---|---|---|
| Nummernvergabe Präfix (ETB/Meldung/Auftrag) | Einsatz-Präfix | effektiv (Einsatz??Org) |
| Nummern-Startwert | Einsatz-Startwert | **unverändert** (rein pro Einsatz) |
| Default-Fristen (Meldung/Auftrag) | Einsatz??Konstante | effektiv (Einsatz??Org??Konstante) |
| Retention-Auto-Befüllung (Abschluss) | Einsatz-Retention | effektiv (Einsatz??Org) |
| Auto-ETB-Schalter | Einsatz-Flag | effektiv (Einsatz??Org??an) |
| Anzeige-Konventionen (FE-Context) | Einsatz-Werte | effektiv (Einsatz??Org??Default) |
| Modul-Guard `benoetigte_rolle` | Einsatz-Override ?? Registry-None | Einsatz-Override ?? Org-Default ?? None |

### Backend — API

- `GET /api/org-einstellungen` (Lesen `admin|fuehrungskraft`) / `PUT` (Schreiben **nur admin** → 403 sonst).
- `GET /api/org-modul-einstellungen` (Lesen) / `PUT` je `modul_key` (Schreiben **nur admin**).
- Einsatz-`GET /einstellungen` wird erweitert: liefert neben den (unveränderten) rohen
  Einsatz-Override-Werten zusätzlich die **Org-Defaults** der vier verschobenen Gruppen
  (als separates `org_defaults`-Objekt), damit die Einsatz-UI „leer = Org-Standard: X"
  anzeigen kann. Den Effektivwert berechnet jeweils der Konsument (Resolver), nicht diese Route.
  Validierung/Org-Isolation strikt per `org_id`/`einsatz_id`. Fehlercodes 400/403/409 wie Haus.

### Frontend — Einsatz-Einstellungen entschlackt

Die vier verschobenen Gruppen **bleiben als optionale Override-Felder**, aber klar sekundär:
jedes Feld zeigt den Org-Standard inline (Platzhalter/Hinweis „Standard (Org): X"); leer =
Org-Standard. `Default-Modul`, `Karten-Defaults`, `Modul-Sichtbarkeit-Override` bleiben
unverändert pro Einsatz.

## Rückwärtskompatibilität & Migration

- Bestehende `einsatz_einstellungen`-Werte bleiben unverändert als Overrides erhalten.
- `org_einstellungen`/`org_modul_einstellung` starten leer/`NULL` → der Effektivwert ist für
  jeden Einsatz identisch zum heutigen hartkodierten Fallback → **null Verhaltensänderung**,
  bis ein Admin Org-Defaults setzt.
- Keine Datenmigration nötig; `einsatz_einstellungen`-Spalten bleiben bestehen (jetzt als Override).

## Fehlerbehandlung

- Validierung in Rust (kein DB-CHECK): ungültiger Wert → 400.
- Schreiben globaler Einstellungen ohne `system_rolle=admin` → 403.
- Org-Isolation: alle Queries strikt per `org_id` (kein Cross-Org-Leck).

## Tests

- **Resolver**: Fallback-Kette je Feld (Einsatz gesetzt → Einsatz; Einsatz NULL + Org gesetzt →
  Org; beide NULL → hartkodiert).
- **Org-Domain**: UPSERT round-trip, Validator-Grenzen, Modul-Rollen-Default UPSERT.
- **Routen-Gating**: `GET` für fuehrungskraft ok; `PUT` für fuehrungskraft → 403; admin → ok;
  ungültiger Wert → 400; Org-Isolation.
- **Konsumenten**: Präfix/Frist/Retention/Auto-ETB/Modul-Rolle beziehen den Org-Default, wenn
  der Einsatz-Override NULL ist; Einsatz-Override schlägt den Org-Default.
- **Frontend**: Admin-Nav + Routing (`/admin`, Redirect `/stammdaten`→`/admin/stammdaten`),
  `GlobalEinstellungenPage` Sektionen + Submit (Feldabdeckung), Edit nur für admin (read-only
  für fuehrungskraft), Einsatz-Override-Hinweis „Standard (Org): X".

## Scope-Grenzen (YAGNI)

- Nummern-Startwerte bekommen keinen Org-Default (bleiben pro Einsatz).
- Karten-Defaults / Default-Modul werden NICHT global (variieren je Lage).
- Kein Multi-Org-UI (T1 hat eine Org, `org_id=1`); die Tabellen sind aber `org_id`-scoped
  für spätere Mandantenfähigkeit.
- Keine Versionierung/Historie der Org-Defaults über das `geaendert_at`/`geaendert_von`-Audit hinaus.
