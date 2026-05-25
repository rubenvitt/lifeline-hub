-- Org-weiter Katalog von Einsatzstichwort-Vorschlägen für die Combobox.
-- Seeding der Startliste passiert in bootstrap_admin (org_id existiert erst
-- zur Laufzeit), nicht hier — eine Migration läuft ohne Organisation.
CREATE TABLE einsatz_stichwort_vorschlag (
    id      INTEGER PRIMARY KEY,
    org_id  INTEGER NOT NULL REFERENCES organisation(id),
    text    TEXT NOT NULL,
    sortier INTEGER NOT NULL DEFAULT 0,
    UNIQUE(org_id, text)
);
