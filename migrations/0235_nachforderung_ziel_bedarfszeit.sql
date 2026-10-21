-- no-transaction
-- LLH-1089: Nachforderung schneller erfassen (design.md D7). Die Bezeichnung (in der Oberfläche
-- „Details / Zweck“) wird optional; neu sind das Ziel (Meldeort: Bereitstellungsraum,
-- Einsatzabschnitt oder Freitext, höchstens eines) und die Bedarfszeit „benötigt bis“.
--
-- SQLite löst ein NOT NULL nur per Tabellen-Neubau. nachforderung ist kein Blatt:
--   etb_eintrag.nachforderung_id          (NO ACTION, 0056)
--   verpflegung_ausgabe.nachforderung_id  (ON DELETE SET NULL, 0120)
--   einsatz_material.nachforderung_id     (ON DELETE SET NULL, 0198)
-- Ein DROP TABLE mit eingeschalteten Fremdschlüsseln löste die SET-NULL-Kaskade aus und bräche an
-- etb_eintrag ab. Deshalb `-- no-transaction` und PRAGMA foreign_keys = OFF (Muster 0159). Die ids
-- bleiben 1:1, sodass alle Kind-FKs nach dem RENAME weiter auflösen. Keine Trigger, keine Views,
-- kein AUTOINCREMENT (kein sqlite_sequence-Eintrag). Schema = 0056 plus `betreuungsstelle_id` aus
-- 0231, geändert ist nur `bezeichnung` (ohne NOT NULL), dazu die vier neuen Spalten und der
-- Höchstens-ein-Ziel-CHECK. Beide Indizes wortgleich neu.
--
-- Ziel: `ziel_br_id` und `ziel_abschnitt_id` mit ON DELETE SET NULL wie `betreuungsstelle_id`: ein
-- Raum geht nur mit dem Einsatz, ein Abschnitt beim Auflösen; der Bezug darf das Löschen nicht
-- aufhalten, der ETB-Wortlaut der Anforderung behält das Ziel. Gleichheit des Einsatzes und
-- Lebenszyklus prüft die Route. `benoetigt_bis` UTC wie `angefordert_at`, NULL = sofort.
-- Abgesichert von db::tests::migration_0235_*.

PRAGMA foreign_keys = OFF;

CREATE TABLE nachforderung_neu (
    id                   INTEGER PRIMARY KEY,
    einsatz_id           INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Bedarf:
    art                  TEXT    NOT NULL,                 -- Kategorie (Freitext, z. B. 'RTW','SEG','Sandsäcke')
    bezeichnung          TEXT,                             -- Details/Zweck, optional (LLH-1089)
    anzahl               INTEGER,                          -- optional; im Code >=1 validiert
    -- Adressat (externe Stelle):
    adressat_kategorie   TEXT    NOT NULL,                 -- 'leitstelle'|'nachbar_ea'|'uebergeordnet'|'andere_bos'
    adressat_bezeichnung TEXT,                             -- Freitext (welche Leitstelle/Nachbar etc.)
    begruendung          TEXT,                             -- optionaler Lagebezug
    prioritaet           TEXT    NOT NULL DEFAULT 'normal', -- 'sofort'|'dringend'|'normal'
    -- Bedarfs-Status (linear + Abzweig): angefordert→zugesagt→unterwegs→eingetroffen | abgelehnt.
    status               TEXT    NOT NULL DEFAULT 'angefordert',
    zugesagt_at          TEXT,
    unterwegs_at         TEXT,
    eingetroffen_at      TEXT,
    abgelehnt_at         TEXT,
    abgelehnt_grund      TEXT,
    angefordert_at       TEXT    NOT NULL,                 -- Ereigniszeit der Anforderung (Default jetzt im Handler)
    -- ETB-Kopplung (Pattern B): erzeugte ETB-Meldung der Anforderung.
    etb_nachforderung_id INTEGER REFERENCES etb_eintrag(id),
    erstellt_von_id      INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    betreuungsstelle_id  INTEGER REFERENCES betreuungsstelle(id) ON DELETE SET NULL,
    -- Ziel/Meldeort (LLH-1089): höchstens eines.
    ziel_br_id           INTEGER REFERENCES bereitstellungsraum(id) ON DELETE SET NULL,
    ziel_abschnitt_id    INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    ziel_text            TEXT,
    -- Bedarfszeit „benötigt bis“ (UTC); NULL = sofort.
    benoetigt_bis        TEXT,
    CHECK ((ziel_br_id IS NOT NULL) + (ziel_abschnitt_id IS NOT NULL)
           + (ziel_text IS NOT NULL) <= 1)
);

INSERT INTO nachforderung_neu
    (id, einsatz_id, art, bezeichnung, anzahl, adressat_kategorie, adressat_bezeichnung,
     begruendung, prioritaet, status, zugesagt_at, unterwegs_at, eingetroffen_at, abgelehnt_at,
     abgelehnt_grund, angefordert_at, etb_nachforderung_id, erstellt_von_id, erstellt_at,
     betreuungsstelle_id)
    SELECT id, einsatz_id, art, bezeichnung, anzahl, adressat_kategorie, adressat_bezeichnung,
           begruendung, prioritaet, status, zugesagt_at, unterwegs_at, eingetroffen_at,
           abgelehnt_at, abgelehnt_grund, angefordert_at, etb_nachforderung_id, erstellt_von_id,
           erstellt_at, betreuungsstelle_id
    FROM nachforderung
    ORDER BY id;

DROP TABLE nachforderung;

ALTER TABLE nachforderung_neu RENAME TO nachforderung;

-- Die Indizes aus 0056 und 0231 fielen mit dem DROP; wortgleich neu.
CREATE INDEX idx_nachforderung_einsatz ON nachforderung(einsatz_id, status);
CREATE INDEX idx_nachforderung_betreuungsstelle ON nachforderung(betreuungsstelle_id)
    WHERE betreuungsstelle_id IS NOT NULL;
-- Neu: Ziele (FK-Aktion beim Löschen, „Nachforderungen mit Ziel dieses Raums“).
CREATE INDEX idx_nachforderung_ziel_br ON nachforderung(ziel_br_id)
    WHERE ziel_br_id IS NOT NULL;
CREATE INDEX idx_nachforderung_ziel_abschnitt ON nachforderung(ziel_abschnitt_id)
    WHERE ziel_abschnitt_id IS NOT NULL;

PRAGMA foreign_keys = ON;
