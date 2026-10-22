-- LLH-1375: Einsatz-Vorlagen je Organisation (design.md D1/D2 der Change llh-1375, Spec
-- `einsatz-vorlagen`). Eine Vorlage speichert die AUSGEBLENDETEN Module: ein neu hinzukommendes
-- Modul ist so in jeder Vorlage sichtbar, wie ohne Vorlage auch. Beim Anlegen eines Einsatzes
-- schreibt `einsatz::repo::anlegen_tx` je ausgeblendetem Modul `einsatz_modul_override(sichtbar = 0)`.
-- Der Einsatz merkt sich die Vorlage nicht. Spaltet eine spätere Migration ein Modul auf (wie
-- 0224), übernimmt sie die Ausblendungen auch in `einsatz_vorlage_modul_aus`.
CREATE TABLE einsatz_vorlage (
    id           INTEGER PRIMARY KEY,
    org_id       INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung  TEXT NOT NULL,
    -- Vorbelegung im Anlegedialog; NULL = keine Vorgabe.
    einsatzart   TEXT
                 CHECK (einsatzart IS NULL
                        OR einsatzart IN ('realeinsatz', 'uebung', 'sanitaetsdienst', 'bereitstellung')),
    sortier      INTEGER NOT NULL DEFAULT 0,
    angelegt_at  TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (org_id, bezeichnung)
);

-- Modulschlüssel aus der Registry (src/einsatz/modul.rs), in Rust geprüft wie bei
-- einsatz_modul_override: bekannt und ausblendbar.
CREATE TABLE einsatz_vorlage_modul_aus (
    vorlage_id INTEGER NOT NULL REFERENCES einsatz_vorlage(id) ON DELETE CASCADE,
    modul_key  TEXT NOT NULL,
    PRIMARY KEY (vorlage_id, modul_key)
);

-- Stichwort-Kopplung (design.md D1, Variante C): Löschen der Vorlage lässt den Vorschlag stehen.
ALTER TABLE einsatz_stichwort_vorschlag
    ADD COLUMN vorlage_id INTEGER REFERENCES einsatz_vorlage(id) ON DELETE SET NULL;

-- Startliste für bestehende Organisationen. No-Op auf frischer DB (keine organisation). Neue
-- Organisationen bekommen sie über bootstrap_admin. Gleiche Werte wie
-- einsatz_vorlage/mod.rs EINSATZ_VORLAGE_STARTLISTE (ausgeblendet = ausblendbare Module minus
-- sichtbare) — Netz: db::tests::migration_0238_seedet_die_startliste.
INSERT INTO einsatz_vorlage (org_id, bezeichnung, einsatzart, sortier)
SELECT o.id, v.bezeichnung, v.einsatzart, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'Kleinlage' AS bezeichnung, 'realeinsatz' AS einsatzart, 10 AS sortier
    UNION ALL SELECT 'Sanitätsdienst',            'sanitaetsdienst', 20
    UNION ALL SELECT 'MANV',                      'realeinsatz',     30
    UNION ALL SELECT 'Personensuche',             'realeinsatz',     40
    UNION ALL SELECT 'Evakuierung und Betreuung', 'realeinsatz',     50
    UNION ALL SELECT 'Unwetter',                  'realeinsatz',     60
) v;

INSERT INTO einsatz_vorlage_modul_aus (vorlage_id, modul_key)
SELECT ev.id, m.modul_key
FROM einsatz_vorlage ev
JOIN (
    SELECT 'Kleinlage' AS bezeichnung, 'einsatzabschnitte' AS modul_key
    UNION ALL SELECT 'Kleinlage', 'lagebesprechung'
    UNION ALL SELECT 'Kleinlage', 'stab'
    UNION ALL SELECT 'Kleinlage', 'material'
    UNION ALL SELECT 'Kleinlage', 'verpflegung'
    UNION ALL SELECT 'Kleinlage', 'bereitstellungsraeume'
    UNION ALL SELECT 'Kleinlage', 'abloesung'
    UNION ALL SELECT 'Kleinlage', 'personen'
    UNION ALL SELECT 'Kleinlage', 'unfallhilfsstellen'
    UNION ALL SELECT 'Kleinlage', 'evakuierung'
    UNION ALL SELECT 'Kleinlage', 'betreuung'
    UNION ALL SELECT 'Kleinlage', 'tiere'
    UNION ALL SELECT 'Kleinlage', 'schaeden'
    UNION ALL SELECT 'Kleinlage', 'lage-dashboard'
    UNION ALL SELECT 'Kleinlage', 'lageberichte'
    UNION ALL SELECT 'Kleinlage', 'wetter-pegel'
    UNION ALL SELECT 'Kleinlage', 'lagemeldungen'
    UNION ALL SELECT 'Kleinlage', 'chat'
    UNION ALL SELECT 'Kleinlage', 'nachforderungen'
    UNION ALL SELECT 'Kleinlage', 'fernmeldewesen'
    UNION ALL SELECT 'Sanitätsdienst', 'lagebesprechung'
    UNION ALL SELECT 'Sanitätsdienst', 'stab'
    UNION ALL SELECT 'Sanitätsdienst', 'bereitstellungsraeume'
    UNION ALL SELECT 'Sanitätsdienst', 'evakuierung'
    UNION ALL SELECT 'Sanitätsdienst', 'betreuung'
    UNION ALL SELECT 'Sanitätsdienst', 'tiere'
    UNION ALL SELECT 'Sanitätsdienst', 'schaeden'
    UNION ALL SELECT 'Sanitätsdienst', 'lageberichte'
    UNION ALL SELECT 'Sanitätsdienst', 'gefahrenzonen'
    UNION ALL SELECT 'Sanitätsdienst', 'wetter-pegel'
    UNION ALL SELECT 'Sanitätsdienst', 'lagemeldungen'
    UNION ALL SELECT 'Sanitätsdienst', 'fernmeldewesen'
    UNION ALL SELECT 'MANV', 'stab'
    UNION ALL SELECT 'MANV', 'verpflegung'
    UNION ALL SELECT 'MANV', 'evakuierung'
    UNION ALL SELECT 'MANV', 'betreuung'
    UNION ALL SELECT 'MANV', 'tiere'
    UNION ALL SELECT 'MANV', 'schaeden'
    UNION ALL SELECT 'MANV', 'wetter-pegel'
    UNION ALL SELECT 'Personensuche', 'stab'
    UNION ALL SELECT 'Personensuche', 'material'
    UNION ALL SELECT 'Personensuche', 'unfallhilfsstellen'
    UNION ALL SELECT 'Personensuche', 'evakuierung'
    UNION ALL SELECT 'Personensuche', 'betreuung'
    UNION ALL SELECT 'Personensuche', 'tiere'
    UNION ALL SELECT 'Personensuche', 'schaeden'
    UNION ALL SELECT 'Personensuche', 'lageberichte'
    UNION ALL SELECT 'Personensuche', 'gefahrenzonen'
    UNION ALL SELECT 'Evakuierung und Betreuung', 'stab'
    UNION ALL SELECT 'Evakuierung und Betreuung', 'unfallhilfsstellen'
    UNION ALL SELECT 'Evakuierung und Betreuung', 'schaeden'
    UNION ALL SELECT 'Evakuierung und Betreuung', 'wetter-pegel'
    UNION ALL SELECT 'Unwetter', 'stab'
    UNION ALL SELECT 'Unwetter', 'personen'
    UNION ALL SELECT 'Unwetter', 'unfallhilfsstellen'
    UNION ALL SELECT 'Unwetter', 'evakuierung'
    UNION ALL SELECT 'Unwetter', 'betreuung'
    UNION ALL SELECT 'Unwetter', 'tiere'
) m ON m.bezeichnung = ev.bezeichnung;
