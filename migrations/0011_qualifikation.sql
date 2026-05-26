-- Org-weiter, admin-pflegbarer Qualifikations-Katalog + echte n:m-Zuordnung.
-- Soft-Delete via aktiv=0 (deaktivierte Qualifikation bleibt in bestehenden
-- Zuordnungen gültig, erscheint aber nicht mehr in der Auswahl).
CREATE TABLE qualifikation (
    id      INTEGER PRIMARY KEY,
    org_id  INTEGER NOT NULL REFERENCES organisation(id),
    label   TEXT NOT NULL,
    sortier INTEGER NOT NULL DEFAULT 0,
    aktiv   INTEGER NOT NULL DEFAULT 1,
    UNIQUE(org_id, label)
);

CREATE TABLE personal_qualifikation (
    personal_id      INTEGER NOT NULL REFERENCES personal(id),
    qualifikation_id INTEGER NOT NULL REFERENCES qualifikation(id),
    PRIMARY KEY (personal_id, qualifikation_id)
);

-- Bestehende Organisation(en) mit dem Default-Katalog seeden. Auf frischer DB ein
-- No-Op; neue Orgs seedet bootstrap_admin (gleiche Werte, siehe personal/mod.rs
-- QUALIFIKATION_STARTLISTE — beide synchron halten).
INSERT INTO qualifikation (org_id, label, sortier)
SELECT o.id, v.label, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'Sanitäter'          AS label, 10 AS sortier
    UNION ALL SELECT 'Rettungssanitäter',  20
    UNION ALL SELECT 'Notfallsanitäter',   30
    UNION ALL SELECT 'Notarzt',            40
    UNION ALL SELECT 'Truppführer',        50
    UNION ALL SELECT 'Gruppenführer',      60
    UNION ALL SELECT 'Zugführer',          70
    UNION ALL SELECT 'Maschinist',         80
    UNION ALL SELECT 'Sprechfunker',       90
) v;
