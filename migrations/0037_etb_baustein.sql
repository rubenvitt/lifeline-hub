-- Org-globaler Katalog vordefinierter ETB-Textbausteine (LFH-42).
CREATE TABLE etb_baustein (
    id              INTEGER PRIMARY KEY,
    org_id          INTEGER NOT NULL REFERENCES organisation(id),
    label           TEXT NOT NULL,
    typ             TEXT NOT NULL
                    CHECK (typ IN ('meldung', 'anordnung', 'lage', 'entscheidung')),
    inhalt          TEXT NOT NULL,
    meldeweg        TEXT
                    CHECK (meldeweg IS NULL OR meldeweg IN ('funk', 'telefon', 'persoenlich', 'sonstige')),
    veranlassung    TEXT,
    sortier         INTEGER NOT NULL DEFAULT 0,
    aktiv           INTEGER NOT NULL DEFAULT 1,
    erstellt_at     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(org_id, label)
);

CREATE INDEX idx_etb_baustein_liste ON etb_baustein(org_id, aktiv, sortier);

-- Seed bestehender Orgs beim Upgrade. No-Op auf frischer DB (keine organisation).
-- Neue Orgs werden via bootstrap_admin geseedet. Gleiche Werte wie
-- etb_baustein/mod.rs ETB_BAUSTEIN_STARTLISTE — beide synchron halten.
INSERT INTO etb_baustein (org_id, label, typ, inhalt, sortier)
SELECT o.id, v.label, v.typ, v.inhalt, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'Lage unverändert'    AS label, 'lage'        AS typ, 'Lage unverändert.'                                       AS inhalt, 10 AS sortier
    UNION ALL SELECT 'Erkundung eingeleitet',     'meldung',      'Erkundung durch {einheit} eingeleitet.',                       20
    UNION ALL SELECT 'Einheit eingetroffen',      'meldung',      '{einheit} um {uhrzeit} an Einsatzstelle eingetroffen.',        30
    UNION ALL SELECT 'Lagemeldung Leitstelle',    'meldung',      'Lagemeldung an Leitstelle zu Einsatz {einsatznr}: {lage}.',    40
    UNION ALL SELECT 'Einsatzabschnitt gebildet', 'entscheidung', 'Einsatzabschnitt {abschnitt} gebildet, Führung {einheit}.',    50
) v;
