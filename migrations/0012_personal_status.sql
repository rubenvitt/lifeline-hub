-- Org-weiter, admin-pflegbarer Personal-Status-Katalog. Schema identisch zu
-- fahrzeug_status MINUS fms_anker (keine FMS-Anbindung bei Personal). Die feste
-- Semantik-Kategorie trägt die App-Logik. Soft-Delete via aktiv=0.
CREATE TABLE personal_status (
    id        INTEGER PRIMARY KEY,
    org_id    INTEGER NOT NULL REFERENCES organisation(id),
    label     TEXT NOT NULL,
    kategorie TEXT NOT NULL
              CHECK (kategorie IN ('verfuegbar', 'gebunden', 'nicht_verfuegbar')),
    farbe     TEXT,                        -- optional, Hex (#rrggbb) für Lageübersicht
    sortier   INTEGER NOT NULL DEFAULT 0,
    aktiv     INTEGER NOT NULL DEFAULT 1,
    UNIQUE(org_id, label)
);

-- Bestehende Organisation(en) seeden (No-Op auf frischer DB; neue Orgs über
-- bootstrap_admin, Werte synchron zu personal/mod.rs PERSONAL_STATUS_STARTLISTE).
INSERT INTO personal_status (org_id, label, kategorie, sortier)
SELECT o.id, v.label, v.kategorie, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'verfügbar'    AS label, 'verfuegbar'       AS kategorie, 10 AS sortier
    UNION ALL SELECT 'alarmiert',    'gebunden',         20
    UNION ALL SELECT 'auf Anfahrt',  'gebunden',         30
    UNION ALL SELECT 'im Einsatz',   'gebunden',         40
    UNION ALL SELECT 'Pause',        'nicht_verfuegbar', 50
    UNION ALL SELECT 'abgemeldet',   'nicht_verfuegbar', 60
) v;
