-- LFH-608: Lage je Einsatzabschnitt für den Führungs-Überblick (S2).
-- Alle vier Angaben sind optional: leer heißt „nicht gepflegt", nicht „planmäßig" oder 0 %.
ALTER TABLE einsatzabschnitt ADD COLUMN kurzbezeichnung TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN lagezustand TEXT
    CHECK (lagezustand IN ('planmaessig', 'angespannt', 'kritisch'));
ALTER TABLE einsatzabschnitt ADD COLUMN abschnittsauftrag TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN fortschritt INTEGER
    CHECK (fortschritt BETWEEN 0 AND 100);

-- Das Kürzel ist ein Rufname im Einsatz („an EA-N"): zweimal vergeben wäre es keiner.
-- NOCASE, weil der Funk Groß-/Kleinschreibung nicht überträgt.
CREATE UNIQUE INDEX einsatzabschnitt_kurzbezeichnung_eindeutig
    ON einsatzabschnitt (einsatz_id, kurzbezeichnung COLLATE NOCASE)
    WHERE kurzbezeichnung IS NOT NULL;
