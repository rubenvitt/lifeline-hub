-- LFH-108: Funk-/Kommunikationsdaten auch an der disponierten Einheit — analog zum
-- Abschnitt-Pattern (LFH-86, migrations/0047_einsatzabschnitt_funk.sql). BEWUSST nur die
-- beiden nicht-redundanten Felder: Sprechgruppen laufen an der Einheit bereits über den
-- Join einsatz_einheit_sprechgruppe (0073), daher hier KEINE sprechgruppe_tmo/_dmo-
-- Freitextspalten (die wären regressiv). Beide nullable TEXT, kein Default, kein CHECK —
-- Voll-Ersatz-Semantik wie bemerkung. erreichbarkeit ist PII (mögliche Rufnummer) und wird
-- in schwaerze_einsatz mit gescrubbt (LFH-108).
ALTER TABLE einsatz_einheit ADD COLUMN kommunikationsmittel TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN erreichbarkeit TEXT;
