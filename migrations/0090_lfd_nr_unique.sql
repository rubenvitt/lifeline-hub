-- Integritäts-Sicherheitsnetz (LFH-259 / F34): server-autoritative, lückenlose lfd_nr je Einsatz.
-- etb/einsatz_person/einsatz_tier/einsatz_schaden tragen UNIQUE(einsatz_id, nr), meldung/auftrag
-- bislang nicht — die Invariante hing dort allein an der atomaren Vergabe im Code
-- (COALESCE(MAX(lfd_nr)+1)). Ein Bug in einem einzelnen Schreibpfad (neuer interner Aufrufer,
-- Scheduler, Seed) könnte still doppelte laufende Nummern persistieren; die Anzeige-Nummer ist
-- aber das operative Referenzmittel im Sprechfunk ("Auftrag 12"). Der UNIQUE-Index macht die
-- Invariante DB-durchgesetzt (Defense-in-Depth, wie bei etb/person).
--
-- meldung.lfd_nr ist NOT NULL → einfacher UNIQUE-Index. auftrag.lfd_nr ist nullable (0067,
-- ADD COLUMN ohne rückwirkenden NOT-NULL-Default): SQLite behandelt NULLs im UNIQUE-Index als
-- verschieden, Altbestand mit NULL-lfd_nr bleibt also kompatibel. Der vorhandene, nicht-unique
-- idx_auftrag_einsatz_lfd_nr wird durch den UNIQUE-Index gleichen Namens ersetzt (bedient den
-- MAX(lfd_nr)-Lookup weiterhin).
CREATE UNIQUE INDEX idx_meldung_einsatz_lfd_nr ON meldung (einsatz_id, lfd_nr);

DROP INDEX IF EXISTS idx_auftrag_einsatz_lfd_nr;
CREATE UNIQUE INDEX idx_auftrag_einsatz_lfd_nr ON auftrag (einsatz_id, lfd_nr);
