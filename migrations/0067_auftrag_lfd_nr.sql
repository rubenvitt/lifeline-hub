-- Laufende Nummer pro Auftrag (LFH-133, operative Vorarbeit für die Nummernkreise).
-- Bislang hatte der Auftrag keine fortlaufende Nummer (Sortierung über prio/frist/id).
-- Für den Nummernkreis-Präfix (analog ETB/Meldung) bekommt der Auftrag eine je Einsatz
-- fortlaufende lfd_nr. ADD COLUMN (kein Rebuild, kein CHECK): nullable, weil ALTER auf
-- einer ggf. befüllten Tabelle keinen NOT-NULL-Default rückwirkend setzen kann; neue
-- Zeilen vergeben die Nummer atomar beim Anlegen (COALESCE(MAX(lfd_nr)+1, ?startwert)).
ALTER TABLE auftrag ADD COLUMN lfd_nr INTEGER;

-- Beschleunigt den MAX(lfd_nr)-Lookup je Einsatz bei der atomaren Vergabe.
CREATE INDEX IF NOT EXISTS idx_auftrag_einsatz_lfd_nr ON auftrag (einsatz_id, lfd_nr);
