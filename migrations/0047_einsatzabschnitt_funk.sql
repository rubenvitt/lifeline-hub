-- LFH-86: Funk-/Kommunikations-Stammdaten je Einsatzabschnitt (einsatz-scoped,
-- entity-gekoppelt analog 0035_lage_taktik). Alle Spalten nullable TEXT, kein
-- Default, kein CHECK. Sprechgruppe getrennt nach Betriebsart (TMO Netz / DMO
-- Direkt); Kommunikationsmittel als Freitext-Schlüssel (Digitalfunk/Mobil/Festnetz);
-- erreichbarkeit = Nummer/Freitext. Funkrufname/OPTA leben an `fahrzeug` (Stammdaten),
-- der Status verfügbar/im Einsatz ist der bestehende Fahrzeug-FMS-Status.
ALTER TABLE einsatzabschnitt ADD COLUMN sprechgruppe_tmo TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN sprechgruppe_dmo TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN kommunikationsmittel TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN erreichbarkeit TEXT;
