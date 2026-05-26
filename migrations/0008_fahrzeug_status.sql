-- Org-weiter, admin-pflegbarer Fahrzeug-Status-Katalog. Die feste Semantik-
-- Kategorie ('verfuegbar'/'gebunden'/'nicht_verfuegbar') trägt die App-Logik;
-- label/farbe/sortier sind frei umbenenn-/umsortierbar. Soft-Delete via aktiv=0.
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

-- Bestehende Organisation(en) mit dem Default-Katalog seeden. Auf einer frischen
-- DB (Migration läuft vor Bootstrap, keine Organisation vorhanden) ist dies ein
-- No-Op; neue Orgs seedet bootstrap_admin (gleiche Werte, siehe fahrzeug/mod.rs
-- STATUS_STARTLISTE — beide synchron halten).
INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker, sortier)
SELECT o.id, v.label, v.kategorie, v.fms_anker, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT '1 – Frei auf Funk'         AS label, 'verfuegbar'       AS kategorie, 1 AS fms_anker, 10 AS sortier
    UNION ALL SELECT '2 – Frei auf Wache',        'verfuegbar',       2, 20
    UNION ALL SELECT '3 – Auf Anfahrt',           'gebunden',         3, 30
    UNION ALL SELECT '4 – Am Einsatzort',         'gebunden',         4, 40
    UNION ALL SELECT '5 – Sprechwunsch',          'gebunden',         5, 50
    UNION ALL SELECT '6 – Nicht einsatzbereit',   'nicht_verfuegbar', 6, 60
    UNION ALL SELECT '7 – Gebunden (Transport)',  'gebunden',         7, 70
    UNION ALL SELECT '8 – Bedingt einsatzbereit', 'gebunden',         8, 80
    UNION ALL SELECT '9 – Fremdanmeldung',        'gebunden',         9, 90
    UNION ALL SELECT '0 – Prio. Sprechwunsch',    'gebunden',         0, 100
) v;
