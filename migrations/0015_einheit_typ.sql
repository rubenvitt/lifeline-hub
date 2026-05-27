-- Org-weiter, admin-pflegbarer Einheitstyp-Katalog mit optionaler Standard-Soll-
-- Stärke (F/UF/M; alle drei oder keiner). Soft-Delete via aktiv=0 (deaktivieren statt
-- löschen). Der CROSS-JOIN-Seed greift nur für bei Migrationszeit vorhandene Orgs;
-- neue Orgs seedet bootstrap_admin (EINHEIT_TYP_STARTLISTE — synchron halten!).
CREATE TABLE einheit_typ (
    id                INTEGER PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organisation(id),
    label             TEXT NOT NULL,
    soll_fuehrer      INTEGER,
    soll_unterfuehrer INTEGER,
    soll_mannschaft   INTEGER,
    sortier           INTEGER NOT NULL DEFAULT 0,
    aktiv             INTEGER NOT NULL DEFAULT 1,
    UNIQUE(org_id, label)
);

INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier)
SELECT o.id, v.label, v.f, v.uf, v.m, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'Trupp'    AS label, 0    AS f, 0    AS uf, 2    AS m, 10 AS sortier
    UNION ALL SELECT 'Staffel',  0,    1,    5,    20
    UNION ALL SELECT 'Gruppe',   0,    1,    8,    30
    UNION ALL SELECT 'Zug',      1,    3,    18,   40
    UNION ALL SELECT 'Sonstige', NULL, NULL, NULL, 50
) v;
