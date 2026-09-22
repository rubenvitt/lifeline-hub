-- LFH-628: erwarteter Höchststand am maßgeblichen Pegel, von Hand gepflegt (Quelle:
-- Hochwasservorhersagezentrale bzw. Stab). Wert und Zeitpunkt gibt es nur zusammen — ein
-- Höchststand ohne Zeitpunkt ist keine Marke, ein Zeitpunkt ohne Wert keine Prognose.
--
-- Spalten an `einsatz_pegel` statt eigener Tabelle: eine Prognose gehört zu genau einer
-- festgelegten Station und fällt mit ihr. Der Vollersatz-PUT der Pegel-Liste fasst die
-- Spalten NICHT an (`repo::ersetzen` setzt im Upsert nur Name, Gewässer, Reihenfolge) —
-- gepinnt von `tests/pegel.rs::put_der_liste_laesst_die_prognose_stehen`.
ALTER TABLE einsatz_pegel ADD COLUMN prognose_cm REAL;
ALTER TABLE einsatz_pegel ADD COLUMN prognose_zeit TEXT
    CHECK ((prognose_cm IS NULL) = (prognose_zeit IS NULL));
ALTER TABLE einsatz_pegel ADD COLUMN prognose_gesetzt_von_id INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_pegel ADD COLUMN prognose_gesetzt_at TEXT;
